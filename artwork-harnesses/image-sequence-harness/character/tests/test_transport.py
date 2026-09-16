"""Contract-shaped HTTP/SSE doubles. No socket is opened."""
import io
import json
import os
import unittest
from unittest.mock import patch

from ai_character_image_sequence import cloud_mcp
from ai_character_image_sequence.storage import HarnessError


class Response(io.BytesIO):
    def __init__(self, data, content_type="application/json"):
        super().__init__(data)
        self.headers = {"Content-Type": content_type}


class TransportCase(unittest.TestCase):
    config = {"adapter": "queued_image_mcp_v1", "key_env": "TEST_MCP_KEY",
              "endpoints": {"generate": "https://example.invalid/image"}}

    def test_json_headers_and_exact_payload(self):
        payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        response = Response(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}).encode())
        with patch.dict(os.environ, {"TEST_MCP_KEY": "test-secret"}), \
             patch.object(cloud_mcp.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = response
            self.assertEqual(cloud_mcp.post(self.config, "generate", payload), {"tools": []})
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header("Authorization"), "Bearer test-secret")
            self.assertEqual(request.get_header("Mcp-protocol-version"), "2025-11-25")
            self.assertEqual(json.loads(request.data), payload)

    def test_sse_ignores_notification_and_matches_id(self):
        raw = (b'data: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'
               b'event: message\r\ndata: {"jsonrpc":"2.0","id":2,\r\n'
               b'data: "result":{"structuredContent":{"status":"queued"}}}\r\n\r\n')
        with patch.dict(os.environ, {"TEST_MCP_KEY": "test-secret"}), \
             patch.object(cloud_mcp.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = Response(raw, "text/event-stream")
            self.assertEqual(cloud_mcp.post(self.config, "generate", {"id": 2})["structuredContent"]["status"], "queued")

    def test_tool_order_not_assumed(self):
        with patch.object(cloud_mcp, "post", return_value={"tools": [
            {"name": "get_task"}, {"name": "unrelated"}, {"name": "imagegen", "inputSchema": {"type": "object"}}
        ]}):
            self.assertEqual(cloud_mcp.list_tools(self.config, "generate")["name"], "imagegen")

    def test_transport_exception_does_not_expose_secrets(self):
        with patch.dict(os.environ, {"TEST_MCP_KEY": "secret"}), \
             patch.object(cloud_mcp.urllib.request, "build_opener") as factory:
            factory.return_value.open.side_effect = OSError("secret https://private.invalid/?token=x")
            with self.assertRaises(HarnessError) as caught:
                cloud_mcp.post(self.config, "generate", {"id": 1})
            self.assertEqual(str(caught.exception), "mcp_transport_or_response_error")

    def test_no_redirect_of_bearer_token(self):
        with self.assertRaises(HarnessError):
            cloud_mcp.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.invalid/other")

    def test_mask_only_cannot_be_configured(self):
        with self.assertRaises(HarnessError):
            cloud_mcp.validate_config({**self.config, "matte_options": {"maskOnly": True}}, "generate")

    def test_endpoint_must_not_embed_credentials(self):
        with self.assertRaises(HarnessError):
            cloud_mcp.validate_config({**self.config, "endpoints": {"generate": "https://example.invalid/?key=secret"}}, "generate")

    def test_provider_model_override_cannot_be_configured(self):
        with self.assertRaises(HarnessError):
            cloud_mcp.validate_config({**self.config, "model": "invented-model"}, "generate")

    def test_access_denied_is_explicit_without_retry_or_spoof(self):
        error = cloud_mcp.urllib.error.HTTPError("https://example.invalid", 403, "Denied", {},
                                               io.BytesIO(b'{"error_code":1010,"detail":"private text"}'))
        with patch.dict(os.environ, {"TEST_MCP_KEY": "test-secret"}), \
             patch.object(cloud_mcp.urllib.request, "build_opener") as factory:
            factory.return_value.open.side_effect = error
            with self.assertRaises(HarnessError) as caught:
                cloud_mcp.post(self.config, "generate", {"id": 1})
            self.assertEqual(str(caught.exception), "mcp_client_access_denied")
            self.assertEqual(factory.return_value.open.call_count, 1)


if __name__ == "__main__":
    unittest.main()
