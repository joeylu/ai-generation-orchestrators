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

from ..canonical import load_json, redact, rooted_path, safe_error_code
from ..media.reference import inspect_generation_reference, prepare_generation_reference
from .base import GenerationFailed, GenerationIndeterminate, GenerationNotSubmitted


VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}


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

    def doctor(self) -> Mapping[str, Any]:
        workflow = self._workflow_path()
        workflow_valid = False
        diagnostic_code = "workflow_missing"
        if workflow.is_file():
            try:
                value = load_json(workflow)
                candidate = copy.deepcopy(value)
                self._bind(candidate, "reference_image", "doctor-reference.png")
                self._bind(candidate, "positive_prompt", "doctor prompt")
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
                "network_probe": "not_performed",
            }
        )  # type: ignore[return-value]

    def preflight(self, plan: Mapping[str, Any]) -> Mapping[str, Any]:
        """Plan-aware input checks only; never create images or make requests."""
        try:
            reference = rooted_path(self.root, str(plan["character"]["reference"]), must_exist=True)
            with Image.open(reference) as source:
                report = inspect_generation_reference(source, str(plan["delivery"]["key_color"]))
            self._check_reference_resize(load_json(self._workflow_path()), str(plan["delivery"]["key_color"]))
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
            self._check_reference_resize(workflow, str(plan["delivery"]["key_color"]))
            with Image.open(reference) as source:
                prepared = prepare_generation_reference(source, str(plan["delivery"]["key_color"]))
            image_buffer = io.BytesIO()
            prepared.save(image_buffer, format="PNG")
        except (OSError, ValueError, KeyError) as exc:
            raise GenerationNotSubmitted(safe_error_code(exc)) from exc
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
        except (OSError, ValueError, HTTPError, URLError) as exc:
            raise GenerationIndeterminate(f"minimax_h3_submission_result_unknown:{type(exc).__name__}") from exc
        request_id = response.get("prompt_id")
        if not isinstance(request_id, str) or not request_id:
            raise GenerationIndeterminate("minimax_h3_prompt_id_missing")
        return request_id

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

    def _bind(self, workflow: dict[str, Any], name: str, value: str) -> None:
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
