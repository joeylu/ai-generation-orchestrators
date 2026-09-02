from __future__ import annotations

from pathlib import Path
import shutil

from . import batch
from .common import digest, identifier, load_verified_image, read_json, require, sha256, write_json


def _verified_handoff(bundle: Path) -> dict:
    bundle = bundle.resolve()
    handoff = read_json(bundle / "handoff.json")
    body = {key: value for key, value in handoff.items() if key != "digest"}
    require(handoff.get("kind") == "ai_ui_decomposition_file_request_v1"
            and handoff.get("digest") == digest(body), "ADAPTER_HANDOFF_CHANGED")
    for row in handoff["files"]:
        path = (bundle / row["path"]).resolve()
        require(path.is_relative_to(bundle) and path.is_file()
                and sha256(path) == row["sha256"], "ADAPTER_INPUT_CHANGED")
    return handoff


def export_request(run: Path, asset: str, bundle: Path) -> dict:
    frozen, _plan = batch.load(run)
    asset = identifier(asset)
    require(asset in frozen["requests"], "UNKNOWN_REQUEST")
    bundle = bundle.resolve()
    require(not bundle.exists(), "ADAPTER_BUNDLE_EXISTS")
    reservation = batch.reserve(run, asset)
    entry = frozen["requests"][asset]
    (bundle / "input").mkdir(parents=True)
    sources = ((run / entry["request"], bundle / "request.json"),
               (run / entry["prompt"], bundle / "prompt.txt"),
               (run / "input" / "reference.png", bundle / "input" / "reference.png"),
               (run / entry["crop"], bundle / "input" / "crop.png"))
    rows = []
    for source, destination in sources:
        shutil.copyfile(source, destination)
        rows.append({"path": destination.relative_to(bundle).as_posix(),
                     "sha256": sha256(destination)})
    request = read_json(bundle / "request.json")
    handoff = {"kind": "ai_ui_decomposition_file_request_v1",
               "batch_digest": frozen["digest"], "asset": asset,
               "request_id": entry["id"], "request_digest": request["digest"],
               "reservation": reservation, "files": rows,
               "expected_result": {"image": "result.png", "manifest": "result.json",
                                   "kind": "ai_ui_decomposition_file_result_v1"},
               "automatic_retries": 0}
    handoff["digest"] = digest(handoff)
    write_json(bundle / "handoff.json", handoff)
    return handoff


def seal_result(bundle: Path, source: Path) -> dict:
    bundle = bundle.resolve()
    handoff = _verified_handoff(bundle)
    destination = bundle / handoff["expected_result"]["image"]
    require(not destination.exists(), "ADAPTER_RESULT_EXISTS")
    source = source.resolve()
    _picture, evidence = load_verified_image(source)
    shutil.copyfile(source, destination)
    require(sha256(destination) == evidence["sha256"], "ADAPTER_RESULT_COPY_CHANGED")
    result = {"kind": "ai_ui_decomposition_file_result_v1", "status": "received",
              "request_id": handoff["request_id"],
              "request_digest": handoff["request_digest"],
              "image": handoff["expected_result"]["image"],
              "image_sha256": sha256(destination), "size": evidence["size"],
              "mode": evidence["mode"]}
    write_json(bundle / handoff["expected_result"]["manifest"], result)
    return result


def import_result(run: Path, bundle: Path) -> dict:
    bundle = bundle.resolve()
    handoff = _verified_handoff(bundle)
    frozen, _plan = batch.load(run)
    require(handoff["batch_digest"] == frozen["digest"], "ADAPTER_BATCH_CHANGED")
    manifest = read_json(bundle / handoff["expected_result"]["manifest"])
    require(manifest.get("kind") == "ai_ui_decomposition_file_result_v1"
            and manifest.get("status") == "received"
            and manifest.get("request_id") == handoff["request_id"]
            and manifest.get("request_digest") == handoff["request_digest"],
            "ADAPTER_RESULT_BINDING")
    image = (bundle / manifest.get("image", "")).resolve()
    require(image.is_relative_to(bundle) and image.is_file()
            and sha256(image) == manifest.get("image_sha256"), "ADAPTER_RESULT_CHANGED")
    return batch.receive(run, handoff["asset"], image)
