from __future__ import annotations

from pathlib import Path
import shutil

from PIL import Image

from .common import (ContractError, digest, identifier, load_verified_image, read_json, require,
                     safe_relative, sha256, write_json)
from .contract import validate
from .resources import require_keyed_input_limit


def run_location(workspace: Path, run_id: str) -> Path:
    root = workspace.resolve()
    run = (root / "runs" / identifier(run_id)).resolve()
    require(run.is_relative_to(root), "RUN_PATH_ESCAPE")
    return run


def _body_digest(record: dict) -> str:
    return digest({key: value for key, value in record.items() if key != "digest"})


def load(run: Path) -> tuple[dict, dict]:
    batch = read_json(run / "batch.json")
    require(batch.get("kind") == "ai_ui_decomposition_batch_v1"
            and batch.get("digest") == _body_digest(batch), "BATCH_CHANGED")
    plan = read_json(run / "plan.json")
    validate(plan, verify_source=False)
    require(digest(plan) == batch["plan_digest"], "PLAN_CHANGED")
    if 'bounded_execution' in batch:
        from .bounded_execution import validate as validate_execution
        entry=batch['bounded_execution'];path=safe_relative(run,entry['path'])
        require(sha256(path)==entry['sha256'],'EXECUTION_POLICY_CHANGED')
        validate_execution(read_json(path),plan)
    if 'capability_preflight' in batch:
        entry=batch['capability_preflight']
        require(sha256(run/'capability-request.json')==entry['request_sha256'] and
                sha256(run/'capability-report.json')==entry['report_sha256'],'CAPABILITY_SNAPSHOT_CHANGED')
    spacing=batch.get('layout_spacing_preflight',{})
    if spacing.get('status')=='passed':
        for name in ('document','plan','report'):
            path=run/f'layout-spacing-{name}.json'
            require(path.is_file() and sha256(path)==spacing[name+'_sha256'],'SPACING_SNAPSHOT_CHANGED')
    reference = run / "input" / "reference.png"
    require(reference.is_file() and sha256(reference) == batch["source_sha256"],
            "SOURCE_SNAPSHOT_CHANGED")
    for asset in plan["assets"]:
        if asset["route"] == "imported_material":
            path = run / "input" / "materials" / (asset["id"] + ".png")
            require(path.is_file() and sha256(path) == asset["material_source"]["sha256"],
                    "IMPORTED_MATERIAL_CHANGED")
    for entry in batch["requests"].values():
        request = safe_relative(run, entry["request"])
        crop = safe_relative(run, entry["crop"])
        prompt = safe_relative(run, entry["prompt"])
        require(sha256(request) == entry["request_sha256"]
                and sha256(crop) == entry["crop_sha256"]
                and sha256(prompt) == entry["prompt_sha256"], "REQUEST_INPUT_CHANGED")
    return batch, plan


def freeze(plan_path: Path, workspace: Path, run_id: str, *, capability_request: Path | None = None, execution_policy: Path | None = None,
           component_document: Path | None = None, layout_spacing: Path | None = None) -> dict:
    plan = read_json(plan_path.resolve())
    plan_base = plan_path.resolve().parent
    summary = validate(plan, source_base=plan_base)
    execution=None
    if execution_policy is not None:
        from .bounded_execution import validate as validate_execution
        execution=validate_execution(read_json(execution_policy),plan)
    capability=None
    capability_input=None
    if capability_request is not None:
        from .capabilities import audit
        capability_input=read_json(capability_request)
        capability=audit(capability_input)
        require(capability['planDigest']==digest(plan),'CAPABILITY_PLAN_MISMATCH')
        require(capability['status']=='capability_supported','CAPABILITY_UNSUPPORTED_BEFORE_FREEZE')
    require((component_document is None)==(layout_spacing is None),'SPACING_PREFLIGHT_ARGUMENTS')
    spacing_document=spacing_plan=spacing_report=None
    if capability_input and any(c['type'] in ('Panel','ScrollView') for c in capability_input['components']):
        require(component_document is not None,'SPACING_PREFLIGHT_REQUIRED')
    if component_document is not None:
        from .layout_spacing import require_export_spacing
        data=read_json(component_document,max_bytes=64*1024*1024)
        spacing_document=data.get('document',data);spacing_plan=read_json(layout_spacing)
        if capability_input:
            def walk(node):
                yield node
                for child in node.get('children',[]):yield from walk(child)
            inventory={n['id']:n['type'] for n in walk(spacing_document['root'])}
            require(all(inventory.get(c['id'])==c['type'] for c in capability_input['components']),'SPACING_CAPABILITY_DOCUMENT_MISMATCH')
        spacing_report=require_export_spacing(spacing_document,spacing_plan)
    run = run_location(workspace, run_id)
    require(not run.exists(), "RUN_EXISTS")
    (run / "input").mkdir(parents=True)
    (run / "requests").mkdir()
    write_json(run / "plan.json", plan)
    source_path = safe_relative(plan_base, plan["source"]["path"])
    reference = run / "input" / "reference.png"
    image, _source_evidence = load_verified_image(source_path, plan["canvas"])
    require(_source_evidence["sha256"] == plan["source"]["sha256"], "SOURCE_CHANGED")
    image.save(reference)
    source_sha = sha256(reference)
    imports = {}
    for asset in plan["assets"]:
        if asset["route"] != "imported_material":
            continue
        destination = run / "input" / "materials" / (asset["id"] + ".png")
        destination.parent.mkdir(exist_ok=True)
        shutil.copyfile(safe_relative(plan_base, asset["material_source"]["path"]), destination)
        require(sha256(destination) == asset["material_source"]["sha256"], "IMPORTED_MATERIAL_CHANGED")
        imports[asset["id"]] = {"path": destination.relative_to(run).as_posix(),
            "sha256": sha256(destination), "generation_calls": 0,
            "origin": "externally_supplied_material", "generation_provenance_verified": False}
    requests = {}
    order = []
    with Image.open(reference) as image:
        image = image.convert("RGBA")
        for asset in plan["assets"]:
            if not asset["route"].startswith("generated_"):
                continue
            key = asset["id"]
            order.append(key)
            request_id = f"{plan['id']}-{key}-r001"
            directory = run / "requests" / request_id
            directory.mkdir()
            crop = directory / "crop.png"
            image.crop(tuple(asset["source_region"])).save(crop)
            prompt = directory / "prompt.txt"
            prompt_text = _prompt(asset)
            prompt.write_text(prompt_text + "\n", encoding="utf-8")
            request = {"kind": "ai_ui_decomposition_provider_request_v1",
                       "id": request_id, "asset": key,
                       "plan_digest": digest(plan), "prompt": prompt_text,
                       "inputs": ["input/reference.png",
                                  crop.relative_to(run).as_posix()],
                       "input_sha256": [source_sha, sha256(crop)],
                       "planned_calls": 0 if "cached_result" in asset else 1,
                       "automatic_retries": 0}
            request["digest"] = digest(request)
            request_path = directory / "request.json"
            write_json(request_path, request)
            requests[key] = {"id": request_id,
                             "request": request_path.relative_to(run).as_posix(),
                             "request_sha256": sha256(request_path),
                             "crop": crop.relative_to(run).as_posix(),
                             "crop_sha256": sha256(crop),
                             "prompt": prompt.relative_to(run).as_posix(),
                             "prompt_sha256": sha256(prompt)}
    batch = {"kind": "ai_ui_decomposition_batch_v1", "run_id": run_id,
             "plan_digest": digest(plan), "source_sha256": source_sha,
             "dispatch_order": order, "requests": requests,
             "maximum_calls": summary["generated_requests"], "automatic_retries": 0,
             "provider": None, "provider_invocation_included": False,
             "plan_summary": summary}
    if imports:
        batch["imported_materials"] = imports
    if capability is not None:
        write_json(run/'capability-request.json',capability_input)
        write_json(run/'capability-report.json',capability)
        batch['capability_preflight']={'request_sha256':sha256(run/'capability-request.json'),
                                      'report_sha256':sha256(run/'capability-report.json'),
                                      'status':'capability_supported'}
    if execution is not None:
        write_json(run/'execution-policy.json',execution)
        batch['bounded_execution']={'path':'execution-policy.json','sha256':sha256(run/'execution-policy.json')}
        batch['maximum_calls']=execution['maximum_calls']
    if spacing_report is not None:
        batch['layout_spacing_preflight']={'status':'passed'}
        for name,value in [('document',spacing_document),('plan',spacing_plan),('report',spacing_report)]:
            path=run/f'layout-spacing-{name}.json';write_json(path,value)
            batch['layout_spacing_preflight'][name+'_sha256']=sha256(path)
    else:
        batch['layout_spacing_preflight']={'status':'legacy_not_checked'}
    batch["digest"] = digest(batch)
    write_json(run / "batch.json", batch)
    return batch


def _prompt(asset: dict) -> str:
    width, height = asset["output_size"]
    # The explicit existing board marker denotes a complete cell inventory.
    # output_size is its preview support, not permission to recenter/resize cells.
    if asset['route']=='generated_isolation' and 'component-family-board-v1:' in asset['prompt']:
        backdrop=('a genuinely transparent RGBA background with real alpha; never a checkerboard'
                  if asset['output_mode']=='transparent_component' else 'a flat uniform vivid magenta #F808F8 background; no checkerboard, gradient or transparency simulation')
        layout=('Keep every part in its explicitly assigned relative search window. Preserve each part\'s aspect ratio; do not merge or reorder parts. '
                if 'component-family-relative-cell-v1' in asset['prompt'] else
                'Keep the explicitly declared raw canvas and every cell coordinate and size. Do not recenter, rescale, merge or reorder the individual parts. ')
        return (asset['prompt'].strip()+' Use the full reference and crop as style evidence. '
                'Return exactly one complete material board on '+backdrop+'. '
                +layout+
                'No text, numerals, pseudo-text, labels, logos or watermarks; preserve intentional pictograms.')
    common = (f" Target support ratio is {width}:{height}. Use the full UI reference and exact "
              "crop as style evidence. Do not draw text, numerals, pseudo-text, labels, logos, "
              "or watermarks. Preserve intentional pictograms and graphic symbols.")
    if asset["route"] == "generated_completion":
        return asset["prompt"].strip() + common + " Return one complete opaque UI-free scene."
    if asset["output_mode"] == "transparent_component":
        return (asset["prompt"].strip() + common
                + " Return exactly one complete component centered on a genuinely transparent "
                  "background with an alpha channel. Leave clean transparent margin on every edge, "
                  "preserve internal holes and soft translucent edges, and do not draw a checkerboard, "
                  "ground, backdrop or cast shadow outside the component.")
    return (asset["prompt"].strip() + common
            + " Return exactly one complete component centered on a flat uniform vivid magenta "
              "#F808F8 background. Leave clean margin on every edge and preserve internal holes. Do not draw a checkerboard or transparency simulation.")


def _require_output_evidence(asset: dict, evidence: dict) -> None:
    if asset["output_mode"] == "transparent_component":
        require(evidence["alpha_extrema"] == [0, 255],
                "TRANSPARENT_RESULT_REQUIRED")
    elif asset["output_mode"] == "opaque_canvas":
        require(evidence["alpha_extrema"] == [255, 255], "OPAQUE_RESULT_REQUIRED")
        target_width, target_height = asset["output_size"]
        raw_width, raw_height = evidence["size"]
        ratio_error = abs((raw_width / raw_height) / (target_width / target_height) - 1.0)
        require(ratio_error <= 0.05, "OPAQUE_RESULT_ASPECT_MISMATCH")


def state(run: Path, entry: dict) -> str:
    directory = run / "requests" / entry["id"]
    received = (directory / "received.json").is_file()
    reused = (directory / "reused.json").is_file()
    indeterminate = (directory / "indeterminate.json").is_file()
    recovered = (directory / "recovered.json").is_file()
    rejected = (directory / "rejected.json").is_file()
    require(sum((received, reused, rejected)) <= 1
            and (not rejected or not indeterminate and not recovered)
            and (not recovered or indeterminate and not received and not reused),
            "CONFLICTING_RESULT_STATE")
    if recovered:
        return "recovered"
    if rejected:
        return "rejected"
    if (directory / "reused.json").is_file():
        return "reused"
    if (directory / "received.json").is_file():
        return "received"
    if (directory / "indeterminate.json").is_file():
        return "indeterminate"
    if (directory / "reserved.json").is_file():
        return "reserved"
    return "prepared"


def reserve(run: Path, asset: str) -> dict:
    frozen,_=load(run)
    if 'bounded_execution' not in frozen:return _reserve(run,asset)
    # One admission + reservation at a time across local processes. A crashed
    # lock is not expired automatically: the caller must reconcile its outcome.
    lock=run/'execution-reservation.lock'
    try:handle=lock.open('x')
    except FileExistsError:raise ContractError('EXECUTION_RESERVATION_BUSY') from None
    try:return _reserve(run,asset)
    finally:handle.close();lock.unlink()


def _reserve(run: Path, asset: str) -> dict:
    batch, plan = load(run)
    asset = identifier(asset)
    require(asset in batch["requests"], "UNKNOWN_REQUEST")
    require("cached_result" not in next(item for item in plan["assets"] if item["id"] == asset),
            "CACHED_RESULT_NO_GENERATION")
    authorization=None
    if 'bounded_execution' in batch:
        from .bounded_execution import admit
        authorization=admit(run,batch,asset)
    else:
        index = batch["dispatch_order"].index(asset)
        for prior in batch["dispatch_order"][:index]:
            require(state(run, batch["requests"][prior]) in {"received", "reused", "recovered", "indeterminate"},
                    "PRIOR_REQUEST_NOT_TERMINAL")
    entry = batch["requests"][asset]
    require(state(run, entry) == "prepared", "REQUEST_ALREADY_STARTED")
    record = {"kind": "ai_ui_decomposition_request_reserved_v1",
              "batch_digest": batch["digest"], "asset": asset,
              "request_id": entry["id"], "request_sha256": entry["request_sha256"],
              "single_use": True, "automatic_retries": 0}
    if authorization is not None:record['execution_authorization_sha256']=authorization
    parallel=run/'parallel-dispatch-authorization.json'
    if authorization is not None and parallel.is_file():record['parallel_dispatch_authorization_sha256']=sha256(parallel)
    write_json(run / "requests" / entry["id"] / "reserved.json", record)
    return record


def receive(run: Path, asset: str, source: Path) -> dict:
    batch, plan = load(run)
    asset = identifier(asset)
    require(asset in batch["requests"], "UNKNOWN_REQUEST")
    entry = batch["requests"][asset]
    require(state(run, entry) == "reserved", "RESERVATION_REQUIRED")
    source = source.resolve()
    require(source.is_file(), "RAW_SOURCE_REQUIRED")
    asset_record = next(item for item in plan["assets"] if item["id"] == asset)
    if asset_record["output_mode"] == "keyed_component":
        _picture, source_evidence = load_verified_image(source)
        require_keyed_input_limit(source_evidence["size"])
    raw = run / "requests" / entry["id"] / "raw.png"
    require(not raw.exists(), "RAW_ALREADY_MATERIALIZED")
    shutil.copyfile(source, raw)
    _image, evidence = load_verified_image(raw)
    try:
        _require_output_evidence(asset_record, evidence)
        if asset_record['output_mode']=='keyed_component':
            from .media import require_explicit_key_background
            require_explicit_key_background(_image)
    except ContractError as exc:
        # A returned, decoded image with wrong output semantics is a known
        # rejection, not an indeterminate provider outcome or reusable result.
        write_json(raw.parent / 'rejected.json', {
            'kind':'ai_ui_decomposition_request_rejected_v1',
            'batch_digest':batch['digest'], 'asset':asset,
            'request_id':entry['id'], 'raw_sha256':sha256(raw),
            'size':evidence['size'], 'mode':evidence['mode'],
            'alpha_extrema':evidence['alpha_extrema'], 'bytes':evidence['bytes'],
            'reason':str(exc), 'generation_calls':1, 'automatic_retries':0,
            'automatic_resubmit':False})
        raise
    record = {"kind": "ai_ui_decomposition_request_received_v1",
              "batch_digest": batch["digest"], "asset": asset,
              "request_id": entry["id"], "raw_sha256": sha256(raw),
              "size": evidence["size"], "mode": evidence["mode"],
              "alpha_extrema": evidence["alpha_extrema"],
              "bytes": evidence["bytes"], "generation_calls": 1,
              "automatic_retries": 0}
    write_json(raw.parent / "received.json", record)
    return record


def indeterminate(run: Path, asset: str, reason: str) -> dict:
    batch, _ = load(run)
    asset = identifier(asset)
    require(asset in batch["requests"] and reason.strip(), "REQUEST_REASON_REQUIRED")
    entry = batch["requests"][asset]
    require(state(run, entry) == "reserved", "RESERVATION_REQUIRED")
    record = {"kind": "ai_ui_decomposition_request_indeterminate_v1",
              "batch_digest": batch["digest"], "asset": asset,
              "request_id": entry["id"], "reason": reason,
              "automatic_resubmit": False, "automatic_retries": 0}
    write_json(run / "requests" / entry["id"] / "indeterminate.json", record)
    return record


def recover_receive(run: Path, asset: str, source: Path) -> dict:
    """Record an explicitly authorized recovery of one known provider result.

    The indeterminate record is retained. This command never contacts a provider
    and cannot be used for a prepared or previously received request.
    """
    frozen, plan = load(run)
    asset = identifier(asset)
    require(asset in frozen["requests"], "UNKNOWN_REQUEST")
    entry = frozen["requests"][asset]
    require(state(run, entry) == "indeterminate", "EXPLICIT_RECOVERY_REQUIRED")
    directory = run / "requests" / entry["id"]
    prior = read_json(directory / "indeterminate.json")
    require(prior.get("kind") == "ai_ui_decomposition_request_indeterminate_v1"
            and prior.get("batch_digest") == frozen["digest"]
            and prior.get("asset") == asset and prior.get("request_id") == entry["id"]
            and prior.get("automatic_resubmit") is False, "INDETERMINATE_BINDING_CHANGED")
    source = source.resolve()
    require(source.is_file(), "RAW_SOURCE_REQUIRED")
    item = next(row for row in plan["assets"] if row["id"] == asset)
    if item["output_mode"] == "keyed_component":
        _picture, source_evidence = load_verified_image(source)
        require_keyed_input_limit(source_evidence["size"])
    raw = directory / "raw.png"
    require(not raw.exists(), "RAW_ALREADY_MATERIALIZED")
    shutil.copyfile(source, raw)
    _image, evidence = load_verified_image(raw)
    _require_output_evidence(item, evidence)
    if item['output_mode'] == 'keyed_component':
        from .media import require_explicit_key_background
        require_explicit_key_background(_image)
    record = {"kind": "ai_ui_decomposition_request_recovered_v1",
              "batch_digest": frozen["digest"], "asset": asset, "request_id": entry["id"],
              "indeterminate_sha256": sha256(directory / "indeterminate.json"),
              "raw_sha256": sha256(raw), "size": evidence["size"], "mode": evidence["mode"],
              "alpha_extrema": evidence["alpha_extrema"], "bytes": evidence["bytes"],
              "generation_calls": 1, "explicit_operator_recovery": True,
              "automatic_resubmit": False, "automatic_retries": 0}
    write_json(directory / "recovered.json", record)
    return record


def status(run: Path) -> dict:
    batch, _ = load(run)
    rows = [{"asset": asset, "request_id": batch["requests"][asset]["id"],
             "state": state(run, batch["requests"][asset])}
            for asset in batch["dispatch_order"]]
    counts = {name: sum(row["state"] == name for row in rows)
              for name in ("prepared", "reserved", "received", "reused", "recovered", "indeterminate", "rejected")}
    return {"kind": "ai_ui_decomposition_batch_status_v1",
            "batch_digest": batch["digest"], "rows": rows, **counts,
            "maximum_calls": batch["maximum_calls"], "automatic_retries": 0}
