"""Optional queued image MCP adapter. Endpoints and keys are private configuration.

Implements the supplied stateless tools/list -> tools/call -> get_task contract.
No business retries, provider selection, URL downloads or backend API access.
"""
from __future__ import annotations

import base64
import json
import os
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

from .storage import HarnessError, canonical, require

PROTOCOL = "2025-11-25"
TOOLS = {"generate": "imagegen", "matte": "remove_background_image",
         "reference-matte": "remove_background_image"}
MODELS = {"General Use (Light)", "General Use (Light 2K)", "General Use (Heavy)",
          "Matting", "Portrait", "General Use (Dynamic)"}


def validate_config(config: dict, operation: str) -> dict:
    require(set(config) <= {"adapter", "key_env", "endpoints", "matte_options", "timeout_seconds"},
            "adapter_config_unknown_field")
    require(config.get("adapter") == "queued_image_mcp_v1", "adapter_unsupported")
    require(bool(re.fullmatch(r"[A-Z][A-Z0-9_]{2,100}", config.get("key_env", ""))), "key_env_invalid")
    endpoints = config.get("endpoints", {})
    require(isinstance(endpoints, dict) and set(endpoints) <= {"generate", "matte"}, "endpoints_invalid")
    endpoint = endpoints.get("generate" if operation == "generate" else "matte", "")
    parsed = urllib.parse.urlsplit(endpoint)
    require(parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username
            and not parsed.password and not parsed.query and not parsed.fragment, "endpoint_invalid")
    options = config.get("matte_options", {})
    require(isinstance(options, dict) and set(options) <= {"model", "operatingResolution", "refineForeground"},
            "matte_options_invalid")
    require("model" not in options or options["model"] in MODELS, "matte_model_invalid")
    require("operatingResolution" not in options or options["operatingResolution"] in
            {"1024x1024", "2048x2048", "2304x2304"}, "matte_resolution_invalid")
    require("refineForeground" not in options or isinstance(options["refineForeground"], bool),
            "matte_refinement_invalid")
    timeout = config.get("timeout_seconds", 45)
    require(type(timeout) is int and 1 <= timeout <= 60, "timeout_invalid")
    return config


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HarnessError("mcp_redirect_forbidden")


def post(config: dict, operation: str, payload: dict) -> dict:
    key = os.environ.get(config["key_env"])
    require(bool(key), "mcp_key_missing")
    data = canonical(payload)
    require(len(data) <= 64 * 1024 * 1024, "mcp_request_too_large")
    endpoint = config["endpoints"]["generate" if operation == "generate" else "matte"]
    request = urllib.request.Request(endpoint, data=data, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL,
    })
    try:
        with urllib.request.build_opener(NoRedirect()).open(
            request, timeout=config.get("timeout_seconds", 45)
        ) as response:
            raw = response.read(64 * 1024 * 1024 + 1)
            content_type = response.headers.get("Content-Type", "")
        require(len(raw) <= 64 * 1024 * 1024, "mcp_response_too_large")
        text = raw.decode("utf-8")
        if "text/event-stream" in content_type:
            messages = []
            for event in text.replace("\r\n", "\n").split("\n\n"):
                parts = [line[5:].lstrip() for line in event.splitlines() if line.startswith("data:")]
                if parts:
                    messages.append(json.loads("\n".join(parts)))
            matching = [m for m in messages if m.get("id") == payload["id"]]
            require(len(matching) == 1, "mcp_sse_response_invalid")
            result = matching[0]
        else:
            result = json.loads(text)
        require(isinstance(result, dict) and result.get("id") == payload["id"], "mcp_response_id_invalid")
        require("error" not in result and isinstance(result.get("result"), dict), "mcp_rpc_error")
        require(not result["result"].get("isError"), "mcp_tool_error")
        return result["result"]
    except HarnessError:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            try:
                error = json.loads(exc.read(8192))
            except (ValueError, OSError):
                error = {}
            if isinstance(error, dict) and error.get("error_code") == 1010:
                raise HarnessError("mcp_client_access_denied") from None
        raise HarnessError(f"mcp_http_{exc.code}") from None
    except urllib.error.URLError as exc:
        reason = exc.reason
        code = ("mcp_tls_error" if isinstance(reason, ssl.SSLError) else
                "mcp_dns_error" if isinstance(reason, socket.gaierror) else
                "mcp_connection_refused" if isinstance(reason, ConnectionRefusedError) else
                "mcp_transport_or_response_error")
        raise HarnessError(code) from None
    except (OSError, ValueError, urllib.error.URLError):
        # Never expose URLs, response bodies, credentials or provider exception strings.
        raise HarnessError("mcp_transport_or_response_error") from None


def list_tools(config: dict, operation: str) -> dict:
    result = post(config, operation, {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    tools = {t.get("name"): t for t in result.get("tools", []) if isinstance(t, dict)}
    require(TOOLS[operation] in tools and "get_task" in tools, "mcp_required_tool_missing")
    return tools[TOOLS[operation]]


def call(config: dict, operation: str, name: str, arguments: dict) -> dict:
    return post(config, operation, {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                                   "params": {"name": name, "arguments": arguments}})


def build_arguments(plan: dict, operation: str, image: bytes, mime: str, config: dict,
                    submission_id: str) -> dict:
    limit = (2 if operation == "generate" else 16) * 1024 * 1024
    require(len(image) <= limit, "cloud_input_size_limit")
    image_object = {"mimeType": mime, "data": base64.b64encode(image).decode("ascii")}
    if operation == "generate":
        return {"submissionId": submission_id, "prompt": plan["prompt"], "referenceImage": image_object}
    return {"submissionId": submission_id, "image": image_object,
            **config.get("matte_options", {}), "maskOnly": False}


def completed_png(result: dict, operation: str) -> tuple[bytes, dict]:
    metadata = result.get("structuredContent", {}).get("result", {})
    require(isinstance(metadata, dict) and metadata.get("mimeType") == "image/png", "cloud_png_required")
    if operation != "generate":
        require(metadata.get("output") == "foreground", "cloud_mask_not_foreground")
    images = [c for c in result.get("content", []) if c.get("type") == "image"]
    require(len(images) == 1 and images[0].get("mimeType") == "image/png", "cloud_inline_png_required")
    try:
        require(len(images[0]["data"]) <= 44 * 1024 * 1024, "cloud_png_too_large")
        data = base64.b64decode(images[0]["data"], validate=True)
    except (ValueError, KeyError):
        raise HarnessError("cloud_base64_invalid") from None
    require(0 < len(data) <= 32 * 1024 * 1024, "cloud_png_too_large")
    require(metadata.get("bytes") == len(data), "cloud_byte_count_mismatch")
    # Signed URLs and any other private service fields are deliberately discarded.
    return data, {k: metadata[k] for k in ("width", "height", "bytes", "mimeType")}
