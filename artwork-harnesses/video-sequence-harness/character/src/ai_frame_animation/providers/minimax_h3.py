from __future__ import annotations

import copy
import io
import json
import time
import uuid
from pathlib import Path
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

from PIL import Image

from ..canonical import canonical_sha256, fingerprint, load_json, redact, rooted_path, safe_error_code
from ..media.reference import inspect_generation_reference, prepare_generation_reference
from .base import GenerationFailed, GenerationIndeterminate, GenerationNotSubmitted


VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
CANVAS_BINDINGS = ("generation_width", "generation_height", "reference_width", "reference_height")
PROVIDER_BINDING_SCHEMA = "ai_frame_animation_provider_binding_v1"

RUNTIME_MODEL_INPUTS = {
    "CheckpointLoaderSimple": ("ckpt_name",),
    "CLIPLoader": ("clip_name",),
    "DualCLIPLoader": ("clip_name1", "clip_name2"),
    "TripleCLIPLoader": ("clip_name1", "clip_name2", "clip_name3"),
    "LoraLoader": ("lora_name",),
    "LoraLoaderModelOnly": ("lora_name",),
    "UNETLoader": ("unet_name",),
    "VAELoader": ("vae_name",),
}


class MiniMaxH3Provider:
    """Optional local ComfyUI MiniMax H3 adapter with exactly one `/prompt` call."""

    def __init__(self, *, config_path: Path, root: Path):
        self.config_path = config_path.resolve(strict=True)
        self.root = root.resolve(strict=True)
        self.config = self._validated_config(load_json(self.config_path))
        self._submitted = False

    @staticmethod
    def _validated_config(value: Mapping[str, Any]) -> dict[str, Any]:
        required = {"base_url", "workflow_path", "bindings"}
        missing = sorted(required - set(value))
        if missing:
            raise ValueError(f"minimax_h3_config_missing:{','.join(missing)}")
        base_url = value.get("base_url")
        if not isinstance(base_url, str):
            raise ValueError("minimax_h3_base_url_must_be_loopback_http")
        parsed = urlsplit(base_url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("minimax_h3_base_url_must_be_loopback_http")
        bindings = value.get("bindings")
        if not isinstance(bindings, Mapping):
            raise ValueError("minimax_h3_bindings_invalid")
        for name in ("reference_image", "positive_prompt"):
            binding = bindings.get(name)
            if not isinstance(binding, Mapping) or not isinstance(binding.get("node"), str) or not isinstance(binding.get("input"), str):
                raise ValueError(f"minimax_h3_binding_invalid:{name}")
        return dict(value)

    def plan_binding(self) -> Mapping[str, Any]:
        """Describe the immutable, host-neutral workflow inputs bound to a plan."""
        canvas = self.config.get("canvas")
        if not isinstance(canvas, Mapping) or set(canvas) != {"width", "height"}:
            raise ValueError("minimax_h3_canvas_invalid")
        width, height = canvas.get("width"), canvas.get("height")
        if (
            isinstance(width, bool)
            or not isinstance(width, int)
            or isinstance(height, bool)
            or not isinstance(height, int)
            or width < 32
            or height < 32
            or width > 16384
            or height > 16384
            or width % 32
            or height % 32
            or width != height
        ):
            raise ValueError("minimax_h3_canvas_must_be_square_multiple_of_32")
        bindings = self.config["bindings"]
        for name in CANVAS_BINDINGS:
            binding = bindings.get(name)
            if not isinstance(binding, Mapping) or not isinstance(binding.get("node"), str) or not isinstance(binding.get("input"), str):
                raise ValueError(f"minimax_h3_binding_invalid:{name}")
        workflow_path = self._workflow_path().resolve(strict=True)
        workflow = load_json(workflow_path)
        self._apply_canvas(workflow, canvas)
        return {
            "schema_version": PROVIDER_BINDING_SCHEMA,
            "workflow_sha256": fingerprint(workflow_path)["sha256"],
            "bindings_sha256": canonical_sha256(bindings),
            "canvas": {
                "width": width,
                "height": height,
            },
        }

    def doctor(self) -> Mapping[str, Any]:
        workflow = self._workflow_path()
        workflow_valid = False
        binding: Mapping[str, Any] | None = None
        diagnostic_code = "workflow_missing"
        if workflow.is_file():
            try:
                value = load_json(workflow)
                candidate = copy.deepcopy(value)
                self._bind(candidate, "reference_image", "doctor-reference.png")
                self._bind(candidate, "positive_prompt", "doctor prompt")
                binding = self.plan_binding() if "canvas" in self.config else None
                workflow_valid = True
                diagnostic_code = "ready"
            except Exception as exc:
                diagnostic_code = safe_error_code(exc)
        return redact(
            {
                "plugin": "minimax_h3",
                "status": "ready" if workflow_valid else "action_required",
                "configuration": "valid",
                "workflow_path": str(workflow),
                "workflow_exists": workflow.is_file(),
                "workflow_valid": workflow_valid,
                "diagnostic_code": diagnostic_code,
                "base_url": self.config["base_url"],
                "canvas": binding["canvas"] if binding is not None else None,
                "network_probe": "not_performed",
            }
        )  # type: ignore[return-value]

    def preflight(self, plan: Mapping[str, Any]) -> Mapping[str, Any]:
        """Plan-aware input checks only; never create images or make requests."""
        try:
            reference = rooted_path(self.root, str(plan["character"]["reference"]), must_exist=True)
            workflow = load_json(self._workflow_path())
            if self._verify_plan_binding(plan):
                self._apply_canvas(workflow, self.config["canvas"])
            with Image.open(reference) as source:
                report = inspect_generation_reference(source, str(plan["delivery"]["key_color"]))
            self._check_reference_resize(workflow, str(plan["delivery"]["key_color"]))
            return report
        except (OSError, ValueError, KeyError) as exc:
            return {"status": "action_required", "diagnostic_code": safe_error_code(exc)}

    def _check_reference_resize(self, workflow: Mapping[str, Any], key_color: str) -> None:
        # Validate the common direct KJ resize without guessing arbitrary graphs.
        # Consumer-owned transforms beyond this still need runtime/visual review.
        reference_node = self.config["bindings"]["reference_image"]["node"]
        expected_key = ",".join(str(int(key_color[index:index + 2], 16)) for index in (1, 3, 5))
        for node in workflow.values():
            if not isinstance(node, Mapping) or node.get("class_type") != "ImageResizeKJv2":
                continue
            inputs = node.get("inputs", {})
            if not isinstance(inputs, Mapping) or inputs.get("image") != [reference_node, 0]:
                continue
            if inputs.get("keep_proportion") != "pad":
                raise ValueError("reference_resize_requires_aspect_preserving_pad")
            if str(inputs.get("pad_color", "")).replace(" ", "") != expected_key:
                raise ValueError("reference_padding_key_mismatch")

    def submit_once(self, plan: Mapping[str, Any], submission_token: str) -> str:
        if self._submitted:
            raise GenerationIndeterminate("provider_instance_already_submitted")
        reference = rooted_path(self.root, str(plan["character"]["reference"]), must_exist=True)  # type: ignore[index]
        try:
            workflow = load_json(self._workflow_path())
            if self._verify_plan_binding(plan):
                self._apply_canvas(workflow, self.config["canvas"])
            self._check_reference_resize(workflow, str(plan["delivery"]["key_color"]))
            with Image.open(reference) as source:
                prepared = prepare_generation_reference(source, str(plan["delivery"]["key_color"]))
            image_buffer = io.BytesIO()
            prepared.save(image_buffer, format="PNG")
        except (OSError, ValueError, KeyError) as exc:
            raise GenerationNotSubmitted(safe_error_code(exc)) from exc
        self._check_runtime_compatibility(workflow)
        try:
            upload = self._upload_reference(reference, submission_token, image_buffer.getvalue())
            workflow = copy.deepcopy(workflow)
            self._bind(workflow, "reference_image", upload["name"])
            self._bind(workflow, "positive_prompt", str(plan["generation"]["prompt"]))  # type: ignore[index]
        except (OSError, ValueError, KeyError, HTTPError, URLError) as exc:
            raise GenerationNotSubmitted(f"minimax_h3_pre_submission_failed:{type(exc).__name__}") from exc

        self._submitted = True
        try:
            response = self._post_json("prompt", {"prompt": workflow, "client_id": submission_token})
        except HTTPError as exc:
            # ComfyUI returns HTTP 400 only after synchronously validating and
            # rejecting the prompt; it has not queued a request in that case.
            # Do not expose its body (node names, paths or workflow details),
            # and do not mislabel this definitive rejection as indeterminate.
            if exc.code == 400:
                raise GenerationNotSubmitted("minimax_h3_prompt_rejected") from exc
            raise GenerationIndeterminate("minimax_h3_submission_result_unknown:HTTPError") from exc
        except (OSError, ValueError, HTTPError, URLError) as exc:
            raise GenerationIndeterminate(f"minimax_h3_submission_result_unknown:{type(exc).__name__}") from exc
        request_id = response.get("prompt_id")
        if not isinstance(request_id, str) or not request_id:
            raise GenerationIndeterminate("minimax_h3_prompt_id_missing")
        return request_id

    def _check_runtime_compatibility(self, workflow: Mapping[str, Any]) -> None:
        """Read-only live check before upload or `/prompt` submission."""
        try:
            self._get_json("system_stats")
            object_info = self._get_json("object_info")
        except (OSError, ValueError, HTTPError, URLError) as exc:
            raise GenerationNotSubmitted("minimax_h3_runtime_unavailable") from exc

        nodes = [node for node in workflow.values() if isinstance(node, Mapping)]
        class_types = {node.get("class_type") for node in nodes if isinstance(node.get("class_type"), str)}
        if any(class_type not in object_info for class_type in class_types):
            raise GenerationNotSubmitted("minimax_h3_runtime_node_missing")

        for node in nodes:
            class_type = node.get("class_type")
            inputs = node.get("inputs")
            if not isinstance(class_type, str) or not isinstance(inputs, Mapping):
                continue
            for input_name in RUNTIME_MODEL_INPUTS.get(class_type, ()):
                selected = inputs.get(input_name)
                if not isinstance(selected, str):
                    continue
                choices = self._runtime_choices(object_info.get(class_type), input_name)
                if choices is None:
                    raise GenerationNotSubmitted("minimax_h3_runtime_model_catalog_unavailable")
                if selected not in choices:
                    raise GenerationNotSubmitted("minimax_h3_runtime_model_missing")

    @staticmethod
    def _runtime_choices(class_info: object, input_name: str) -> set[str] | None:
        if not isinstance(class_info, Mapping):
            return None
        inputs = class_info.get("input")
        if not isinstance(inputs, Mapping):
            return None
        for group_name in ("required", "optional"):
            group = inputs.get(group_name)
            if not isinstance(group, Mapping):
                continue
            specification = group.get(input_name)
            if not isinstance(specification, list) or not specification:
                continue
            values = specification[0]
            if isinstance(values, list) and all(isinstance(value, str) for value in values):
                return set(values)
        return None

    def await_result(self, request_id: str, destination: Path) -> Path:
        deadline = time.monotonic() + float(self.config.get("timeout_seconds", 1800))
        interval = max(0.1, float(self.config.get("poll_interval_seconds", 2)))
        last_history_error: str | None = None
        while time.monotonic() < deadline:
            try:
                history = self._get_json(f"history/{request_id}")
            except (OSError, ValueError, HTTPError, URLError) as exc:
                last_history_error = type(exc).__name__
                time.sleep(interval)
                continue
            record = history.get(request_id)
            if isinstance(record, Mapping):
                status = record.get("status")
                if isinstance(status, Mapping) and status.get("status_str") in {"error", "failed"}:
                    raise GenerationFailed("minimax_h3_generation_failed")
                output = self._find_video(record)
                if output is not None:
                    return self._download(output, destination)
            time.sleep(interval)
        suffix = f":{last_history_error}" if last_history_error else ""
        raise GenerationIndeterminate(f"minimax_h3_result_timeout{suffix}")

    def _workflow_path(self) -> Path:
        value = Path(str(self.config["workflow_path"]))
        return value.resolve(strict=False) if value.is_absolute() else (self.config_path.parent / value).resolve(strict=False)

    def _verify_plan_binding(self, plan: Mapping[str, Any]) -> bool:
        provider = plan.get("provider")
        binding = provider.get("binding") if isinstance(provider, Mapping) else None
        if binding is None:
            return False
        if not isinstance(binding, Mapping) or dict(binding) != dict(self.plan_binding()):
            raise ValueError("minimax_h3_provider_binding_mismatch")
        return True

    def _apply_canvas(self, workflow: dict[str, Any], canvas: Mapping[str, Any]) -> None:
        self._bind(workflow, "generation_width", int(canvas["width"]))
        self._bind(workflow, "generation_height", int(canvas["height"]))
        self._bind(workflow, "reference_width", int(canvas["width"]))
        self._bind(workflow, "reference_height", int(canvas["height"]))

    def _bind(self, workflow: dict[str, Any], name: str, value: object) -> None:
        binding = self.config["bindings"][name]
        node = workflow.get(binding["node"])
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise ValueError(f"minimax_h3_workflow_node_missing:{name}")
        if binding["input"] not in node["inputs"]:
            raise ValueError(f"minimax_h3_workflow_input_missing:{name}")
        node["inputs"][binding["input"]] = value

    def _upload_reference(self, path: Path, token: str, prepared_png: bytes) -> Mapping[str, str]:
        boundary = f"----ai-frame-animation-{uuid.uuid4().hex}"
        if any(character in path.name for character in ('"', "\r", "\n")):
            raise ValueError("minimax_h3_reference_filename_invalid")
        content_type = "image/png"
        filename = f"reference-{uuid.uuid4().hex}.png"
        prefix = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        suffix = (
            f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\nfalse"
            f"\r\n--{boundary}--\r\n"
        ).encode("utf-8")
        request = Request(
            self._url("upload/image"),
            data=prefix + prepared_png + suffix,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Submission-Token": token},
            method="POST",
        )
        response = self._open_json(request)
        name = response.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("minimax_h3_upload_name_missing")
        return {"name": name}

    def _find_video(self, record: Mapping[str, Any]) -> Mapping[str, str] | None:
        outputs = record.get("outputs")
        if not isinstance(outputs, Mapping):
            return None
        for output in outputs.values():
            if not isinstance(output, Mapping):
                continue
            for values in output.values():
                if not isinstance(values, list):
                    continue
                for item in values:
                    if not isinstance(item, Mapping):
                        continue
                    filename = item.get("filename")
                    if isinstance(filename, str) and Path(filename).suffix.lower() in VIDEO_EXTENSIONS:
                        return {
                            "filename": filename,
                            "subfolder": str(item.get("subfolder", "")),
                            "type": str(item.get("type", "output")),
                        }
        return None

    def _download(self, output: Mapping[str, str], destination: Path) -> Path:
        query = urlencode(output)
        request = Request(self._url(f"view?{query}"), method="GET")
        temporary = destination.with_name(f".{destination.name}.tmp")
        maximum = int(self.config.get("max_video_bytes", 2 * 1024 * 1024 * 1024))
        if maximum < 1:
            raise GenerationIndeterminate("minimax_h3_max_video_bytes_invalid")
        try:
            with urlopen(request, timeout=float(self.config.get("request_timeout_seconds", 30))) as response:
                destination.parent.mkdir(parents=True, exist_ok=True)
                total = 0
                with temporary.open("xb") as handle:
                    for chunk in iter(lambda: response.read(1024 * 1024), b""):
                        total += len(chunk)
                        if total > maximum:
                            raise GenerationIndeterminate("minimax_h3_video_exceeds_limit")
                        handle.write(chunk)
        except (HTTPError, URLError, OSError) as exc:
            temporary.unlink(missing_ok=True)
            raise GenerationIndeterminate(f"minimax_h3_video_download_failed:{type(exc).__name__}") from exc
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        if temporary.stat().st_size == 0:
            temporary.unlink(missing_ok=True)
            raise GenerationIndeterminate("minimax_h3_video_empty")
        temporary.replace(destination)
        return destination

    def _url(self, relative: str) -> str:
        return urljoin(str(self.config["base_url"]).rstrip("/") + "/", relative)

    def _post_json(self, relative: str, payload: object) -> dict[str, Any]:
        request = Request(
            self._url(relative),
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        return self._open_json(request)

    def _get_json(self, relative: str) -> dict[str, Any]:
        return self._open_json(Request(self._url(relative), method="GET"))

    def _open_json(self, request: Request) -> dict[str, Any]:
        with urlopen(request, timeout=float(self.config.get("request_timeout_seconds", 30))) as response:
            value = json.loads(response.read().decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("minimax_h3_response_invalid")
        return value
