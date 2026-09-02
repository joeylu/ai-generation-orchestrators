"""Optional stateless async MCP adapter. Endpoints and credentials are deployment-owned.

Implements the documented vision/description and imagegen/downloadUrl tool shapes;
this is not a universal MCP client. Importing it performs no network access.
"""
from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid

from PIL import Image, ImageDraw

from .adapter import _verified_handoff
from .common import ContractError, digest, load_verified_image, read_json, require, write_json


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ContractError("MCP_REDIRECT_REJECTED")


def _url(value: object) -> str:
    require(isinstance(value, str), "MCP_URL")
    parsed = urlsplit(value)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username
            and not parsed.password and not parsed.fragment, "MCP_HTTPS_REQUIRED")
    return parsed.hostname.lower()


def _environment(name: object) -> str:
    require(isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name),
            "MCP_ENV_NAME")
    value = os.environ.get(name)
    require(isinstance(value, str) and value and "\r" not in value and "\n" not in value,
            "MCP_ENV_MISSING")
    return value


def _optional_environment(name: object) -> str | None:
    if name is None:
        return None
    return _environment(name)


def _jpeg(picture: Image.Image) -> dict:
    picture = picture.convert("RGB")
    for quality in (90, 75, 55, 35):
        output = io.BytesIO()
        picture.save(output, format="JPEG", quality=quality)
        if output.tell() <= 2_097_152:
            return {"mimeType": "image/jpeg", "data": base64.b64encode(output.getvalue()).decode("ascii")}
    raise ContractError("MCP_REFERENCE_BYTE_LIMIT")


class AsyncMcpProvider:
    def __init__(self, options: dict):
        require(set(options) == {"vision_url_env", "imagegen_url_env", "api_key_env",
                                 "download_hosts"}, "MCP_OPTIONS")
        # A frozen material-only run does not need a vision endpoint.  Keep the
        # endpoint optional at construction, but make planning reject it
        # explicitly before any network request.
        self.vision_url = _optional_environment(options["vision_url_env"])
        self.imagegen_url = _environment(options["imagegen_url_env"])
        self.key = _environment(options["api_key_env"])
        for value in (self.vision_url, self.imagegen_url):
            if value is None:
                continue
            _url(value)
            require(not urlsplit(value).query, "MCP_ENDPOINT_QUERY_FORBIDDEN")
        hosts = options["download_hosts"]
        require(isinstance(hosts, list) and hosts and all(isinstance(host, str)
            and re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", host) for host in hosts),
            "MCP_DOWNLOAD_HOST_ALLOWLIST")
        self.download_hosts = set(hosts)

    @staticmethod
    def _remaining(deadline: float) -> float:
        remaining = deadline - time.monotonic()
        require(remaining > 0, "MCP_DEADLINE_EXCEEDED")
        return min(30.0, remaining)

    def _read(self, request: Request, deadline: float, maximum: int) -> bytes:
        try:
            with build_opener(_NoRedirect()).open(request, timeout=self._remaining(deadline)) as response:
                chunks = []
                total = 0
                while True:
                    self._remaining(deadline)
                    chunk = response.read(min(65536, maximum + 1 - total))
                    if not chunk:
                        return b"".join(chunks)
                    total += len(chunk)
                    require(total <= maximum, "MCP_RESPONSE_BYTE_LIMIT")
                    chunks.append(chunk)
        except ContractError:
            raise
        except Exception as exc:
            raise ContractError("MCP_TRANSPORT_FAILED_NO_RESUBMIT") from exc

    def _rpc(self, endpoint: str, method: str, params: dict, deadline: float,
             *, evidence_dir: Path | None = None) -> dict:
        call_id = uuid.uuid4().hex
        body = {"jsonrpc": "2.0", "id": call_id, "method": method, "params": params}
        if evidence_dir is not None:
            # Private, bounded transport evidence must survive parser failures.
            # Do not copy this directory into delivery or print its contents.
            evidence_dir.mkdir(parents=True, exist_ok=False)
            write_json(evidence_dir / "request.json", {"id": call_id, "method": method,
                "tool": params.get("name"), "params_digest": digest(params)})
        request = Request(endpoint, data=json.dumps(body).encode("utf-8"), method="POST",
                          headers={"Authorization": "Bearer " + self.key,
                                   "Content-Type": "application/json",
                                   "User-Agent": "Mozilla/5.0",
                                   "Accept": "application/json, text/event-stream",
                                   "MCP-Protocol-Version": "2025-11-25"})
        payload = self._read(request, deadline, 8_388_608)
        if evidence_dir is not None:
            with (evidence_dir / "response.bin").open("xb") as stream:
                stream.write(payload)
        try:
            raw = payload.decode("utf-8-sig")
            if raw.lstrip().startswith("{"):
                envelopes = [json.loads(raw)]
            else:
                envelopes = []
                for event in raw.replace("\r\n", "\n").split("\n\n"):
                    data = "\n".join(line[5:].lstrip() for line in event.splitlines()
                                     if line.startswith("data:"))
                    if data:
                        envelopes.append(json.loads(data))
            require(envelopes, "MCP_INVALID_RESPONSE")
            matches = [row for row in envelopes if isinstance(row, dict) and row.get("id") == call_id]
            require(len(matches) == 1, "MCP_RPC_ID")
            require("error" not in matches[0], "MCP_RPC_REJECTED")
            result = matches[0].get("result")
            require(isinstance(result, dict), "MCP_RESULT_SHAPE")
            require(not result.get("isError"), "MCP_TOOL_REJECTED")
            return result
        except ContractError:
            # ContractError subclasses ValueError: keep a valid remote rejection
            # distinct from JSON/UTF-8 decoding errors instead of swallowing it.
            raise
        except (ValueError, KeyError, TypeError) as exc:
            raise ContractError("MCP_INVALID_RESPONSE") from exc

    def _tools(self, endpoint: str, name: str, deadline: float) -> None:
        result = self._rpc(endpoint, "tools/list", {}, deadline)
        rows = result.get("tools", [])
        require(isinstance(rows, list) and {name, "get_task"} <= {
            row.get("name") for row in rows if isinstance(row, dict)}, "MCP_REQUIRED_TOOL_MISSING")

    def _task(self, endpoint: str, name: str, arguments: dict, state: Path, deadline: float) -> dict:
        require(not state.exists(), "MCP_ATTEMPT_ALREADY_EXISTS")
        state.mkdir(parents=True)
        args = {**arguments, "submissionId": str(uuid.uuid4())}
        # Disk reservation precedes network I/O. Even though this protocol describes
        # idempotent replay, core policy deliberately never automatically resubmits.
        write_json(state / "submission.json", {"tool": name, "arguments": args})
        try:
            result = self._rpc(endpoint, "tools/call", {"name": name, "arguments": args}, deadline,
                               evidence_dir=state / "rpc-0000")
        except ContractError:
            write_json(state / "outcome.json", {"status": "receipt_unavailable_no_resubmit",
                "acceptance": "not_established", "task_id_received": False,
                "automatic_resubmit": False})
            raise
        receipt = result.get("structuredContent")
        require(isinstance(receipt, dict) and isinstance(receipt.get("taskId"), str), "MCP_TASK_RECEIPT")
        task_id = receipt["taskId"]
        require(0 < len(task_id) <= 200, "MCP_TASK_ID")
        write_json(state / "task.json", {"taskId": task_id, "submissionId": args["submissionId"]})
        poll_index = 0
        while True:
            status = receipt.get("status")
            require(status in {"queued", "running", "completed", "failed"}, "MCP_TASK_STATUS")
            if status == "failed":
                write_json(state / "failed.json", {"status": "failed", "automatic_resubmit": False})
                raise ContractError("MCP_TASK_FAILED_NO_RESUBMIT")
            if status == "completed":
                completed = receipt.get("result")
                require(isinstance(completed, dict), "MCP_TASK_RESULT")
                return completed
            delay = receipt.get("pollAfterSeconds", 5)
            require(type(delay) in (int, float) and 0 < delay <= 60, "MCP_POLL_INTERVAL")
            time.sleep(min(delay, self._remaining(deadline)))
            poll_index += 1
            reply = self._rpc(endpoint, "tools/call", {"name": "get_task",
                              "arguments": {"taskId": task_id}}, deadline,
                              evidence_dir=state / f"rpc-{poll_index:04d}")
            receipt = reply.get("structuredContent")
            require(isinstance(receipt, dict) and receipt.get("taskId") == task_id,
                    "MCP_TASK_BINDING")

    def plan(self, reference: Path, instruction: str, *, state_dir: Path, timeout: float) -> str:
        require(isinstance(instruction, str) and 1 <= len(instruction) <= 4096,
                "MCP_VISION_INSTRUCTION_LIMIT")
        require(instruction == instruction.strip(), "MCP_VISION_INSTRUCTION_WHITESPACE")
        require(self.vision_url is not None, "MCP_VISION_ENDPOINT_UNCONFIGURED")
        deadline = time.monotonic() + timeout
        self._tools(self.vision_url, "vision", deadline)
        self._tools(self.imagegen_url, "imagegen", deadline)
        picture, _ = load_verified_image(reference)
        result = self._task(self.vision_url, "vision", {"images": [_jpeg(picture)],
            "instruction": instruction}, state_dir, deadline)
        require(isinstance(result.get("description"), str), "MCP_VISION_DESCRIPTION")
        return result["description"]

    def generate(self, bundle: Path, *, state_dir: Path, timeout: float) -> Path:
        _verified_handoff(bundle)
        deadline = time.monotonic() + timeout
        self._tools(self.imagegen_url, "imagegen", deadline)
        reference, _ = load_verified_image(bundle / "input" / "reference.png")
        crop, _ = load_verified_image(bundle / "input" / "crop.png")
        board = Image.new("RGB", (1280, 960), "#404040")
        draw = ImageDraw.Draw(board)
        for x, picture, label in ((0, reference, "FULL UI - style and context"),
                                  (640, crop, "TARGET CROP - isolate this component")):
            picture = picture.convert("RGB")
            picture.thumbnail((608, 900))
            board.paste(picture, (x + (640 - picture.width) // 2, 45 + (900 - picture.height) // 2))
            draw.text((x + 16, 16), label, fill="white")
        prompt = ((bundle / "prompt.txt").read_text(encoding="utf-8")
                  + "\nThe reference is an evidence board: LEFT is the full UI, RIGHT is the target crop. "
                  "Return only the requested artwork, never the board, labels or grey padding.")
        require(len(prompt) <= 20000, "MCP_IMAGEGEN_PROMPT_LIMIT")
        result = self._task(self.imagegen_url, "imagegen", {"prompt": prompt,
                            "referenceImage": _jpeg(board)}, state_dir, deadline)
        return self._download_completed(result, state_dir, deadline)

    def _download_completed(self, result: dict, state_dir: Path, deadline: float) -> Path:
        url = result.get("downloadUrl")
        require(_url(url) in self.download_hosts, "MCP_DOWNLOAD_HOST_REJECTED")
        expected_bytes = result.get("bytes")
        require(type(expected_bytes) is int and 0 < expected_bytes <= 67_108_864,
                "MCP_DOWNLOAD_SIZE")
        require(result.get("mimeType") == "image/png", "MCP_DOWNLOAD_TYPE")
        # Signed media URLs never receive the MCP Authorization header. Redirects
        # are prohibited and returned hosts must be explicitly deployment-allowlisted.
        payload = self._read(Request(url, headers={"User-Agent": "Mozilla/5.0"}),
                             deadline, expected_bytes)
        require(len(payload) == expected_bytes, "MCP_DOWNLOAD_SIZE_MISMATCH")
        require(payload.startswith(b"\x89PNG\r\n\x1a\n"), "MCP_DOWNLOAD_NOT_PNG")
        destination = state_dir / "raw.png"
        with destination.open("xb") as stream:
            stream.write(payload)
        _picture, evidence = load_verified_image(destination)
        require(evidence["size"] == [result.get("width"), result.get("height")],
                "MCP_DOWNLOAD_DIMENSIONS")
        write_json(state_dir / "received.json", {"status": "downloaded", **evidence})
        return destination

    def recover_generate(self, bundle: Path, *, state_dir: Path, timeout: float) -> Path:
        """Retrieve one persisted task only; never submit imagegen again."""
        _verified_handoff(bundle)
        state_dir = state_dir.resolve()
        task = read_json(state_dir / "task.json")
        require(isinstance(task.get("taskId"), str) and isinstance(task.get("submissionId"), str),
                "MCP_TASK_BINDING")
        require((state_dir / "submission.json").is_file(), "MCP_SUBMISSION_REQUIRED")
        deadline = time.monotonic() + timeout
        counter = 1
        while True:
            path = state_dir / f"rpc-recovery-{counter:04d}"
            reply = self._rpc(self.imagegen_url, "tools/call", {"name": "get_task",
                              "arguments": {"taskId": task["taskId"]}}, deadline, evidence_dir=path)
            receipt = reply.get("structuredContent")
            require(isinstance(receipt, dict) and receipt.get("taskId") == task["taskId"],
                    "MCP_TASK_BINDING")
            status = receipt.get("status")
            require(status in {"queued", "running", "completed", "failed"}, "MCP_TASK_STATUS")
            if status == "failed":
                write_json(state_dir / "recovery-failed.json", {"status": "failed",
                    "automatic_resubmit": False})
                raise ContractError("MCP_TASK_FAILED_NO_RESUBMIT")
            if status == "completed":
                require(not (state_dir / "recovered-raw.png").exists(), "MCP_RECOVERY_ALREADY_DOWNLOADED")
                result = receipt.get("result")
                require(isinstance(result, dict), "MCP_TASK_RESULT")
                # Keep original task download separate from ordinary initial output.
                raw = self._download_completed(result, state_dir, deadline)
                raw.rename(state_dir / "recovered-raw.png")
                return state_dir / "recovered-raw.png"
            delay = receipt.get("pollAfterSeconds", 5)
            require(type(delay) in (int, float) and 0 < delay <= 60, "MCP_POLL_INTERVAL")
            time.sleep(min(delay, self._remaining(deadline)))
            counter += 1


def create_provider(options: dict) -> AsyncMcpProvider:
    return AsyncMcpProvider(options)
