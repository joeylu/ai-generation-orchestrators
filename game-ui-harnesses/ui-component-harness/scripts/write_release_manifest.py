"""Write a deterministic digest manifest for an already-built local release."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


def digest(path: Path) -> dict[str, object]:
    payload = path.read_bytes()
    return {
        "file": path.name,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--verification", type=Path, required=True)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    version = package["version"]
    output = args.output_dir.resolve()
    verification_path = args.verification.resolve()
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    if verification.get("status") != "PASS":
        raise ValueError("release verification did not pass")
    browser = verification.get("browser", {}).get("stats", {})
    if browser.get("unexpected") != 0 or browser.get("flaky") != 0:
        raise ValueError("browser verification is not clean")
    unit_command = next(item for item in verification["commands"] if item["name"] == "unit")
    unit_log = verification_path.parent / unit_command["log"]
    match = re.search(r"^.*\btests\s+(\d+)\r?$", unit_log.read_text(encoding="utf-8"), re.MULTILINE)
    if match is None:
        raise ValueError("unit test count is missing")

    files = [
        output / f"ai-ui-component-harness-{version}.tgz",
        output / f"ui-component-harness-v{version}-source.zip",
        output / f"ui-component-harness-v{version}-source.json",
        output / "release-verification.json",
    ]
    if any(not path.is_file() for path in files):
        raise FileNotFoundError("release artifact is missing")

    manifest = {
        "schemaVersion": "1",
        "name": package["name"],
        "version": version,
        "status": "PASS",
        "verification": {
            "commands": [
                {"name": item["name"], "status": item["status"]}
                for item in verification["commands"]
            ],
            "unitTests": int(match.group(1)),
            "browserTests": browser["expected"],
            "browserUnexpected": browser["unexpected"],
            "browserFlaky": browser["flaky"],
        },
        "artifacts": [digest(path) for path in files],
    }
    destination = output / "release-manifest.json"
    destination.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
