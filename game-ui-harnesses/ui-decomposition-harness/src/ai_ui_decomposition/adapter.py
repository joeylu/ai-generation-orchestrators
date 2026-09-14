from __future__ import annotations

from pathlib import Path
import shutil
import hashlib
import difflib

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


def builtin_image_arguments(bundle: Path) -> dict:
    """Local invocation arguments from verified bytes; never reconstruct a prompt.

    Returning arguments is not proof that a provider call occurred. The caller
    must forward this object directly and separately retain the actual result.
    """
    bundle=bundle.resolve();handoff=_verified_handoff(bundle)
    request=read_json(bundle/'request.json')
    require(request.get('digest')==digest({k:v for k,v in request.items() if k!='digest'}) and
            request['digest']==handoff['request_digest'],'ADAPTER_REQUEST_CHANGED')
    require((bundle/'prompt.txt').read_text(encoding='utf-8')==request['prompt']+'\n','ADAPTER_PROMPT_CHANGED')
    return {'prompt':request['prompt'],'referenced_image_paths':[
        str(bundle/'input/reference.png'),str(bundle/'input/crop.png')]}


def audit_submitted_prompt(bundle: Path, actual_prompt: Path, output: Path) -> dict:
    """Preserve a caller-reported actual tool argument without rewriting receipts."""
    args=builtin_image_arguments(bundle)
    expected=args['prompt'];actual=actual_prompt.read_text(encoding='utf-8').rstrip('\r\n')
    changes=[{'expected_range':[a,b],'actual_range':[c,d],'expected':expected[a:b],'actual':actual[c:d]}
             for op,a,b,c,d in difflib.SequenceMatcher(None,expected,actual,autojunk=False).get_opcodes() if op!='equal']
    report={'kind':'ai_ui_submission_prompt_audit_v1','status':'matched' if actual==expected else 'request_prompt_mismatch',
            'request_digest':_verified_handoff(bundle)['request_digest'],
            'expected_prompt_sha256':hashlib.sha256(expected.encode()).hexdigest(),
            'actual_prompt_sha256':hashlib.sha256(actual.encode()).hexdigest(),'changes':changes,
            'evidence_basis':'caller-retained actual tool argument; not independent provider attestation',
            'generation_calls':0,'human_visual_acceptance':False}
    report['digest']=digest(report);write_json(output,report);return report


def export_request(run: Path, asset: str, bundle: Path) -> dict:
    frozen, plan = batch.load(run)
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
    asset_record = next(row for row in plan["assets"] if row["id"] == asset)
    handoff = {"kind": "ai_ui_decomposition_file_request_v1",
               "batch_digest": frozen["digest"], "asset": asset,
               "request_id": entry["id"], "request_digest": request["digest"],
               "reservation": reservation, "files": rows,
               "expected_result": {"image": "result.png", "manifest": "result.json",
                                   "kind": "ai_ui_decomposition_file_result_v1",
                                   "output_mode": asset_record["output_mode"]},
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
