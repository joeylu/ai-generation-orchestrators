"""Build and re-read an allowlisted reproducible source ZIP; never publish it."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "AGENTS.md", ".gitignore", "LICENSE", "README.md", "SKILL.md", "skill.json",
    "package.json", "package-lock.json", "tsconfig.json", "tsconfig.lib.json",
    "vite.config.ts", "playwright.config.ts", "index.html", "workbench.html",
    "analysis/button-confirm.intent.json",
)
TREES = ("src", "tests", "scripts", "docs", "examples", "prompts", "agents", "skills", "reports", "public/fixtures")
SUFFIXES = {".ts", ".mjs", ".py", ".md", ".json", ".yaml", ".css", ".svg", ".png", ".log"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if not isinstance(version, str) or any(c not in "0123456789.-abcdefghijklmnopqrstuvwxyz" for c in version):
        raise ValueError("unsafe package version")
    paths = {ROOT / name for name in FILES}
    for tree in TREES:
        folder = ROOT / tree
        for path in folder.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"symlink is not packageable: {path.relative_to(ROOT)}")
            if path.is_file() and path.suffix in SUFFIXES and "__pycache__" not in path.parts:
                paths.add(path)
    data: dict[str, bytes] = {}
    for path in sorted(paths):
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError("source path escapes package root")
        data[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    checksum = "".join(f"{hashlib.sha256(payload).hexdigest()}  {name}\n" for name, payload in sorted(data.items()))
    data["SHA256SUMS"] = checksum.encode("utf-8")
    destination = output / f"ui-component-harness-v{version}-source.zip"
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, payload in sorted(data.items()):
            info = zipfile.ZipInfo(f"ui-component-harness/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, payload, compresslevel=9)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(data) == len(set(archive.namelist()))
        for name, payload in data.items():
            assert archive.read(f"ui-component-harness/{name}") == payload
    payload = destination.read_bytes()
    result = {"status": "PASS", "file": destination.name, "bytes": len(payload),
              "sha256": hashlib.sha256(payload).hexdigest(), "entries": len(data),
              "verifiedChecksums": len(data) - 1}
    (output / f"ui-component-harness-v{version}-source.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
