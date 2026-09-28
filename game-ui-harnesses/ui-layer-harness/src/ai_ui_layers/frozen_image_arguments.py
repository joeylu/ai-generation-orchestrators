"""Local, data-only stdio MCP transport for one reserved image request.

Uses only the standard library. It cannot generate, select paths, or submit jobs.
The configured payload is hash-pinned; one exclusive read record prevents replay.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

TRANSPORT = 'local_frozen_image_arguments_v1'
TOOL = 'read_arguments'
RELAY_CODE = '''// @exec: {"yield_time_ms": 120000, "max_output_tokens": 1000}
const frozen = await tools.mcp__ui_layer_frozen__read_arguments({});
if (frozen.isError || !frozen.structuredContent) throw new Error("FROZEN_ARGUMENTS_UNAVAILABLE");
const result = await tools.image_gen__imagegen(frozen.structuredContent);
generatedImage(result);'''


def is_relay_code(code):
    """Recognize only the fixed program, permitting whitespace outside tokens.

    No JS evaluation, interpolation, comments, extra statements or expressions.
    The pragma is compared as data; the body retains identifier/string/operator
    boundaries, so deleting spaces cannot merge keywords or split operators.
    """
    def tokens(source):
        first,body=source.strip().split('\n',1)
        if not first.startswith('// @exec:') or json.loads(first[9:])!={
                'yield_time_ms':120000,'max_output_tokens':1000}:
            raise ValueError('UNSUPPORTED_RELAY')
        if not re.search(r'\bthrow[ \t]+new\b',body):raise ValueError('UNSUPPORTED_RELAY')
        pattern=r'[A-Za-z_$][A-Za-z_0-9$]*|"(?:[^"\\\r\n]|\\.)*"|\|\||[{}().;!=]'
        values=[];end=0
        for match in re.finditer(pattern,body):
            if body[end:match.start()].strip():raise ValueError('UNSUPPORTED_RELAY')
            values.append(match.group());end=match.end()
        if body[end:].strip():raise ValueError('UNSUPPORTED_RELAY')
        return values
    try:
        return tokens(code)==tokens(RELAY_CODE)
    except (ValueError,TypeError):
        return False


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def fingerprint(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def write_new(path, value):
    with Path(path).open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(encoded(value).decode('utf-8'))


def tool_arguments(request, transparent_background):
    if type(transparent_background) is not bool:
        raise ValueError('TRANSPARENCY_MODE_UNVERIFIED')
    return dict(prompt=request['arguments']['prompt'],
                num_last_images_to_include=len(request['arguments']['referenced_image_paths']),
                transparent_background=transparent_background)


def prepare(folder, request, transparent_background):
    payload = dict(kind=TRANSPORT, submissionDigest=request['submissionDigest'],
                   arguments=tool_arguments(request, transparent_background))
    validate(payload)
    path = Path(folder)/'frozen-image-arguments.json'
    write_new(path, payload)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(payload):
    if (not isinstance(payload, dict) or set(payload) != {'kind', 'submissionDigest', 'arguments'}
            or payload['kind'] != TRANSPORT or not isinstance(payload['submissionDigest'], str)
            or not payload['submissionDigest']):
        raise ValueError('FROZEN_ARGUMENTS_INVALID')
    args = payload['arguments']
    if (not isinstance(args, dict) or set(args) != {'prompt', 'num_last_images_to_include', 'transparent_background'}
            or not isinstance(args['prompt'], str) or not args['prompt'].strip()
            or type(args['num_last_images_to_include']) is not int
            or not 1 <= args['num_last_images_to_include'] <= 5
            or type(args['transparent_background']) is not bool):
        raise ValueError('FROZEN_ARGUMENTS_INVALID')


def load_payload(path, expected_sha):
    data = Path(path).read_bytes()
    if len(data) > 1024*1024 or hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError('FROZEN_ARGUMENTS_CHANGED')
    payload = json.loads(data)
    validate(payload)
    return payload


class ArgumentServer:
    def __init__(self, path, expected_sha):
        self.path = Path(path)
        self.expected_sha = expected_sha
        load_payload(self.path, expected_sha)
        self.initialized = False

    def handle(self, message):
        method = message.get('method')
        params = message.get('params', {})
        if method == 'initialize':
            version = params.get('protocolVersion')
            if version not in ('2024-11-05', '2025-03-26', '2025-06-18'):
                version = '2025-06-18'
            return dict(protocolVersion=version, capabilities={'tools': {}},
                        serverInfo={'name': 'ui_layer_frozen', 'version': '1'},
                        instructions='Read only the reserved frozen arguments once. Forward structuredContent unchanged; never retype the prompt or retry generation.')
        if method == 'notifications/initialized':
            self.initialized = True
            return None
        if method == 'ping':
            return {}
        if not self.initialized:
            raise ValueError('MCP_NOT_INITIALIZED')
        if method == 'tools/list':
            return {'tools': [dict(name=TOOL,
                description='Return the exact arguments of the one already reserved image request. No path input, network, generation or retry. Use structuredContent directly.',
                inputSchema={'type': 'object', 'properties': {}, 'additionalProperties': False},
                outputSchema={'type': 'object', 'properties': {
                    'prompt': {'type': 'string'}, 'num_last_images_to_include': {'type': 'integer'},
                    'transparent_background': {'type': 'boolean'}},
                    'required': ['prompt', 'num_last_images_to_include', 'transparent_background'], 'additionalProperties': False},
                annotations={'readOnlyHint': True, 'destructiveHint': False, 'idempotentHint': False, 'openWorldHint': False})]}
        if method != 'tools/call' or params.get('name') != TOOL or params.get('arguments', {}) != {}:
            raise ValueError('MCP_REQUEST_NOT_ALLOWED')
        try:
            payload = load_payload(self.path, self.expected_sha)
            args = payload['arguments']
            # Persist before returning. Repeated reads, even after restart, fail closed.
            write_new(self.path.with_name('frozen-arguments-read.json'), dict(
                kind=TRANSPORT, submissionDigest=payload['submissionDigest'],
                payloadSha256=self.expected_sha, argumentsSha256=fingerprint(args)))
            return dict(content=[{'type': 'text', 'text': encoded(args).decode('utf-8')}],
                        structuredContent=args, isError=False)
        except (OSError, ValueError):
            return dict(content=[{'type': 'text', 'text': 'FROZEN_ARGUMENTS_UNAVAILABLE; stop without resubmission.'}], isError=True)


def serve(server, source, target):
    for line in source:
        ident = None
        notification = False
        try:
            message = json.loads(line)
            if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
                raise ValueError('MCP_INVALID_MESSAGE')
            ident = message.get('id')
            notification = 'id' not in message
            result = server.handle(message)
            if notification:
                continue
            response = dict(jsonrpc='2.0', id=ident, result=result)
        except (ValueError, TypeError, AttributeError):
            if notification:
                continue
            response = dict(jsonrpc='2.0', id=ident, error={'code': -32602, 'message': 'MCP_REQUEST_NOT_ALLOWED'})
        target.write(encoded(response)+b'\n')
        target.flush()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--payload', required=True)
    parser.add_argument('--sha256', required=True)
    opts = parser.parse_args()
    serve(ArgumentServer(opts.payload, opts.sha256), sys.stdin.buffer, sys.stdout.buffer)
