"""Isolated trusted workflow adapter invocation.

Factories remain trusted local code.  A node process communicates failure to
the controller through a small, deliberately redacted file beside its
context; exception details must never become workflow artifacts or output.
"""
import importlib
from pathlib import Path
import re
import sys

from .common import ContractError, read_json, write_json


_ERROR_KIND = "ui_workflow_node_error_v1"
_GENERIC_ERROR_CODE = "WORKFLOW_NODE_FAILED"
_CONTRACT_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,99}\Z")


def _error_code(error: Exception) -> str:
    """Return the only exception information that may cross the process boundary."""
    if isinstance(error, ContractError):
        code = str(error)
        if _CONTRACT_CODE.fullmatch(code):
            return code
    return _GENERIC_ERROR_CODE


def _write_error(directory: Path, error: Exception) -> None:
    """Write a provider-neutral failure record without exception details."""
    write_json(directory / "error.json", {
        "kind": _ERROR_KIND,
        "code": _error_code(error),
    })


def main() -> int:
    context_path = None
    try:
        # Keep malformed invocation quiet as this process is supervised by the
        # workflow controller.  There is no node directory to report without
        # a context argument, but the exit code still signals failure.
        if len(sys.argv) != 2:
            return 1
        context_path = Path(sys.argv[1])
        context = read_json(context_path, max_bytes=16 * 1024 * 1024)
        module, name = context["spec"]["factory"].split(":")
        driver = getattr(importlib.import_module(module), name)(context["spec"]["options"])
        result = driver.run(context)
        write_json(context_path.parent / "result.json", result)
        return 0
    except Exception as error:
        if context_path is None:
            return 1
        try:
            _write_error(context_path.parent, error)
        except Exception:
            # An error record is best effort, but failure to persist it must
            # still be visible to the controller through a non-zero exit.
            return 1
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
