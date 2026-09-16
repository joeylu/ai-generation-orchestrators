"""Public CLI. All exceptions are reduced to safe technical codes."""
from __future__ import annotations

import argparse
import json
import os
from importlib.resources import files
from pathlib import Path

from jsonschema import Draft202012Validator

from . import __version__, cloud_mcp, workflow
from .media import gif_ticks
from .planning import create_plan, workspace
from .storage import HarnessError, contained, digest, require, save


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="ai-character-image-sequence")
    result.add_argument("--version", action="version", version=__version__)
    commands = result.add_subparsers(dest="command", required=True)
    for name in ("init", "plan", "doctor", "probe", "import-raw", "import-matte", "review", "authorize",
                 "submit", "poll", "preview-align", "process", "deliver", "inspect", "prepare-reference"):
        command = commands.add_parser(name)
        command.add_argument("--root", type=Path, required=True)
        if name not in {"init", "plan", "doctor", "probe"}:
            command.add_argument("--plan", required=True, help="Immutable plan digest")
        if name == "plan":
            command.add_argument("--request", type=Path, default=Path("request.json"))
        if name == "import-raw":
            command.add_argument("--image", type=Path, required=True)
        if name == "import-matte":
            command.add_argument("--handoff", type=Path, required=True)
        if name in {"doctor", "probe", "authorize", "submit", "poll"}:
            command.add_argument("--config", type=Path, required=True,
                                 help="Private config below root/.character-image-sequence/")
        if name in {"doctor", "probe", "authorize", "submit"}:
            command.add_argument("--operation", choices=["generate", "matte", "reference-matte"], required=True)
        if name == "authorize":
            command.add_argument("--confirm", action="store_true", help="Only after explicit user compute approval")
            command.add_argument("--retry-after", help="Prior terminal attempt explicitly reconsidered by the user")
        if name == "submit":
            command.add_argument("--authorization", required=True)
        if name == "poll":
            command.add_argument("--attempt", required=True)
        if name == "review":
            command.add_argument("--stage", choices=list(workflow.REVIEW_CHECKS), required=True)
            command.add_argument("--decision", choices=["approved", "rejected"], required=True)
            command.add_argument("--reviewer", required=True)
            command.add_argument("--note", required=True)
            command.add_argument("--check", action="append", default=[],
                                 help="Repeat for every inspected criterion; see inspect output")
        if name == "deliver":
            command.add_argument("--out", type=Path, required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("--directory", type=Path, required=True)
    commands.add_parser("self-test")
    return result


def dispatch(args: argparse.Namespace) -> dict:
    command = args.command
    if command == "self-test":
        schema = json.loads(files(__package__).joinpath("schemas/request.schema.json").read_text())
        Draft202012Validator.check_schema(schema)
        require(sum(gif_ticks(1010)) == 1010, "self_test_timing_failed")
        return {"status": "pass", "version": __version__, "checks": ["packaged_schema", "rational_gif_timing"],
                "cloud_calls": 0}
    if command == "validate":
        return workflow.validate_delivery(args.directory.resolve())
    root = args.root.resolve()
    if command == "init":
        require(not root.exists() or (root.is_dir() and not any(root.iterdir())), "workspace_not_empty")
        root.mkdir(parents=True, exist_ok=True)
        workspace(root)
        (root / ".gitignore").write_text("*\n", encoding="utf-8")
        save(root / "request.json", {"reference": "reference.png", "motion": "Describe one character action",
                                    "phases": ["Start", "Develop", "Resolve", "Return or settle"],
                                    "loop": True, "duration_ms": 1000, "board_size": 1024,
                                    "frame_size": 256, "alignment_mode": "none",
                                    "alignment_reference_frame": 1, "gif": True})
        return {"status": "initialized", "next": "add_reference_and_edit_request", "cloud_calls": 0}
    require(root.is_dir(), "workspace_missing")
    if command == "doctor":
        config = workflow.config_at(root, args.config, args.operation)
        ready = bool(os.environ.get(config["key_env"]))
        return {"status": "ready" if ready else "not_ready", "adapter": config["adapter"],
                "credential_present": ready, "cloud_calls": 0,
                "live_service_verified": False, "code": None if ready else "mcp_key_missing"}
    if command == "probe":
        config = workflow.config_at(root, args.config, args.operation)
        tool = cloud_mcp.list_tools(config, args.operation)
        schema = tool.get("inputSchema")
        require(isinstance(schema, dict), "mcp_input_schema_missing")
        Draft202012Validator.check_schema(schema)
        return {"status": "ready", "operation": args.operation, "tool": tool.get("name"),
                "input_schema_digest": digest(schema), "cloud_calls": 1,
                "business_submissions": 0}
    if command == "plan":
        plan = create_plan(root, args.request)
        return {"status": "planned" if plan["reference_preparation"] else "reference_preparation_required",
                "reference_needs_cloud_matte": plan["reference_needs_cloud_matte"] if not plan["reference_preparation"] else False,
                "plan_digest": plan["digest"], "layout": [4, 4],
                "frames": 16, "cloud_calls": 0,
                "plan_file": f".character-image-sequence/plans/{plan['digest']}.json"}
    if command == "import-raw":
        receipt = workflow.import_raw(root, args.plan, args.image)
        return {"status": "raw_imported", "sha256": receipt["sha256"], "cloud_calls": 0}
    if command == "prepare-reference":
        receipt = workflow.prepare_reference(root, args.plan)
        return {"status": "reference_review_required", "sha256": receipt["sha256"], "cloud_calls": 0,
                "reference_image": f".character-image-sequence/runs/{args.plan}/reference.png"}
    if command == "import-matte":
        receipt = workflow.import_matte(root, args.plan, args.handoff)
        return {"status": "matte_imported", "sha256": receipt["sha256"], "cloud_calls": 0}
    if command == "review":
        receipt = workflow.review(root, args.plan, args.stage, args.decision, args.reviewer, args.note, args.check)
        result = {"status": receipt["decision"], "review_digest": receipt["digest"], "cloud_calls": 0}
        if args.stage == "reference" and args.decision == "approved":
            result["reference_preparation_handoff"] = (
                f".character-image-sequence/runs/{args.plan}/reference-preparation-handoff.json")
        return result
    if command == "authorize":
        receipt = workflow.authorize(root, args.plan, args.operation, args.config, args.confirm, args.retry_after)
        return {"status": "authorized", "authorization": receipt["id"], "binding": receipt["binding"],
                "expires_at": receipt["expires_at"], "cloud_calls": 0}
    if command == "submit":
        return workflow.submit(root, args.plan, args.operation, args.config, args.authorization)
    if command == "poll":
        return workflow.poll(root, args.plan, args.config, args.attempt)
    if command == "preview-align":
        preview = workflow.preview_alignment(root, args.plan)
        return {"status": "unverified_alignment_preview", "cloud_calls": 0,
                "alignment": preview["alignment"],
                "directory": f".character-image-sequence/runs/{args.plan}/alignment-preview",
                "before_gif": f".character-image-sequence/runs/{args.plan}/alignment-preview/before-gray-512.gif",
                "after_gif": f".character-image-sequence/runs/{args.plan}/alignment-preview/after-gray-512.gif"}
    if command == "process":
        candidate = workflow.process(root, args.plan)
        return {"status": "candidate_review_required", "candidate_digest": candidate["digest"],
                "warnings": candidate["warnings"], "cloud_calls": 0,
                "candidate_directory": f".character-image-sequence/runs/{args.plan}/candidate",
                "review_directory": f".character-image-sequence/runs/{args.plan}/candidate/review"}
    if command == "deliver":
        return workflow.deliver(root, args.plan, args.out)
    if command == "inspect":
        return workflow.inspect(root, args.plan)
    raise HarnessError("command_unknown")


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        result = dispatch(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get("status") in {"failed", "indeterminate", "not_ready", "rejected"} else 0
    except HarnessError as exc:
        print(json.dumps({"status": "failed", "code": exc.code}))
        return 2
    except Exception:
        print(json.dumps({"status": "failed", "code": "invalid_input_or_local_io_error"}))
        return 2
