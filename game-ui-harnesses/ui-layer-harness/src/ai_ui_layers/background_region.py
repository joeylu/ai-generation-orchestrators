"""Offline explicit-mask background candidates. No generation or DAG promotion."""
import hashlib
import io
import json
import stat
from pathlib import Path

import numpy as np
from PIL import Image, PngImagePlugin

from .evaluate import save
from .freeze_visual import body_digest


MAX_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 16_777_216
MAX_SIDE = 8192
MAX_JSON_BYTES = 2_097_152
FILES = ('source.png', 'edit-mask.png', 'blend-mask.png', 'preview.png')
BLEND_POLICY = dict(space='encoded-RGB-not-linear-light', arithmetic='uint32',
                    formula='(source * (255 - weight) + proposal * weight + 127) // 255',
                    rounding='round-half-up', resizing='forbidden',
                    colorProfile='identical-ICC-sRGB-gAMA-cHRM; retain-source-color-profile')
REGION_POLICY = dict(editMask='explicit-full-canvas-binary-L-0-or-255',
                     blendMask='explicit-full-canvas-L-0-through-255',
                     support='blend-nonzero-exactly-edit-255',
                     protected='edit-0-exact-source', core='blend-255-exact-proposal',
                     inference='no-bbox-or-occlusion-mask-inference',
                     preview='protected-source; half-magenta-core; half-amber-transition')
EVIDENCE = dict(maskCoverageProven=False, generationReceiptVerified=False,
                humanVisualAcceptance=False, originalDagPromoted=False,
                modelCalls=0, generationCalls=0,
                regionMeaning='Caller-declared permitted replacement and weights; not user approval or a certified occlusion mask.',
                limitations='Does not prove complete UI/shadow coverage or reconstruction of hidden background.')


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _sha_required(value, role):
    if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('BG_REGION_' + role + '_SHA256_REQUIRED')


def _safe_path(path):
    path = Path(path).absolute()
    ancestor = Path(path.anchor)
    for part in path.parts[1:]:
        ancestor /= part
        if ancestor.is_symlink() or getattr(ancestor, 'is_junction', lambda: False)():
            raise ValueError('BG_REGION_LINK_PATH_FORBIDDEN')
        try:
            attributes = getattr(ancestor.lstat(), 'st_file_attributes', 0)
        except FileNotFoundError:
            continue
        if attributes & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0):
            raise ValueError('BG_REGION_LINK_PATH_FORBIDDEN')
    return path


def _read(path, limit=None):
    # A single bounded read is the identity subsequently decoded and copied.
    limit = MAX_BYTES if limit is None else limit
    with _safe_path(path).open('rb') as stream:
        raw = stream.read(limit + 1)
    if not raw or len(raw) > limit:
        raise ValueError('BG_REGION_FILE_SIZE')
    return raw


def _bound(path, expected, role):
    _sha_required(expected, role)
    raw = _read(path)
    if _sha(raw) != expected:
        raise ValueError('BG_REGION_' + role + '_CHANGED')
    return raw


def _profile(raw, icc):
    # Preserve encoded standard color chunks exactly, rather than round-tripping floats.
    chunks = {}
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('BG_REGION_INVALID_PNG')
    offset = 8
    seen_data = seen_palette = ended = False
    while offset < len(raw):
        if len(raw) - offset < 12:
            raise ValueError('BG_REGION_INVALID_PNG')
        length = int.from_bytes(raw[offset:offset + 4], 'big')
        kind = raw[offset + 4:offset + 8]
        if offset + length + 12 > len(raw):
            raise ValueError('BG_REGION_INVALID_PNG')
        if offset == 8 and (kind != b'IHDR' or length != 13):
            raise ValueError('BG_REGION_INVALID_PNG')
        if offset == 8 and raw[offset + 16] != 8:
            raise ValueError('BG_REGION_8_BIT_PNG_REQUIRED')
        if kind == b'IHDR' and offset != 8:
            raise ValueError('BG_REGION_INVALID_PNG')
        if kind in (b'sRGB', b'gAMA', b'cHRM', b'iCCP'):
            if seen_data or seen_palette:
                raise ValueError('BG_REGION_LATE_COLOR_PROFILE')
            if kind in chunks:
                raise ValueError('BG_REGION_DUPLICATE_COLOR_PROFILE')
            chunks[kind] = raw[offset + 8:offset + 8 + length]
        if kind == b'eXIf' and seen_data:
            raise ValueError('BG_REGION_LATE_ORIENTATION')
        seen_data |= kind == b'IDAT'
        seen_palette |= kind == b'PLTE'
        offset += length + 12
        if kind == b'IEND':
            if length or not seen_data or offset != len(raw):
                raise ValueError('BG_REGION_PNG_END_OR_TRAILING_DATA')
            ended = True
            break
    if not ended:
        raise ValueError('BG_REGION_INVALID_PNG')
    if b'iCCP' in chunks and b'sRGB' in chunks:
        raise ValueError('BG_REGION_CONFLICTING_COLOR_PROFILE')
    if b'sRGB' in chunks and (len(chunks[b'sRGB']) != 1 or chunks[b'sRGB'][0] > 3):
        raise ValueError('BG_REGION_COLOR_PROFILE')
    if b'gAMA' in chunks and (len(chunks[b'gAMA']) != 4 or int.from_bytes(chunks[b'gAMA'], 'big') == 0):
        raise ValueError('BG_REGION_COLOR_PROFILE')
    if b'cHRM' in chunks and len(chunks[b'cHRM']) != 32:
        raise ValueError('BG_REGION_COLOR_PROFILE')
    if (b'iCCP' in chunks) != (icc is not None):
        raise ValueError('BG_REGION_ICC_PROFILE')
    return dict(icc=icc, chunks={k: v for k, v in chunks.items() if k != b'iCCP'})


def _color_evidence(profile):
    return dict(iccSha256=_sha(profile['icc']) if profile['icc'] is not None else None,
                **{key: profile['chunks'][key.encode()].hex() if key.encode() in profile['chunks'] else None
                   for key in ('sRGB', 'gAMA', 'cHRM')})


def _decode(raw, mask=False, size=None):
    try:
        # getexif() may load a PNG; verify on its own fresh stream first.
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != 'PNG':
                raise ValueError('BG_REGION_SINGLE_ORIENTED_PNG_REQUIRED')
            if not 1 <= min(image.size) or max(image.size) > MAX_SIDE or image.width * image.height > MAX_PIXELS:
                raise ValueError('BG_REGION_IMAGE_SIZE')
            image.verify()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != 'PNG' or image.getexif().get(274, 1) != 1 or getattr(image, 'n_frames', 1) != 1:
                raise ValueError('BG_REGION_SINGLE_ORIENTED_PNG_REQUIRED')
            if not 1 <= min(image.size) or max(image.size) > MAX_SIDE or image.width * image.height > MAX_PIXELS:
                raise ValueError('BG_REGION_IMAGE_SIZE')
            if size is not None and image.size != size:
                raise ValueError('BG_REGION_CANVAS_MISMATCH')
            mode = image.mode
            icc = image.info.get('icc_profile')
            if icc is not None and (not isinstance(icc, bytes) or not icc or len(icc) > 1024 * 1024):
                raise ValueError('BG_REGION_ICC_PROFILE')
            profile = _profile(raw, icc)
            if mask and (mode != 'L' or 'transparency' in image.info or icc is not None or profile['chunks']):
                raise ValueError('BG_REGION_UNPROFILED_L_MASK_REQUIRED')
            if not mask and mode not in ('RGB', 'RGBA'):
                raise ValueError('BG_REGION_RGB_OR_RGBA_REQUIRED')
            dimensions = image.size
            if mask:
                pixels = np.array(image, dtype=np.uint8)
            else:
                rgba = np.array(image.convert('RGBA'), dtype=np.uint8)
                if not np.all(rgba[:, :, 3] == 255):
                    raise ValueError('BG_REGION_OPAQUE_IMAGE_REQUIRED')
                pixels = rgba[:, :, :3].copy()
        return pixels, dimensions, profile, mode
    except (OSError, SyntaxError, Image.DecompressionBombError) as error:
        raise ValueError('BG_REGION_INVALID_PNG') from error


def _masks(edit, weight):
    if not np.all((edit == 0) | (edit == 255)):
        raise ValueError('BG_REGION_BINARY_EDIT_MASK_REQUIRED')
    if not np.array_equal(weight != 0, edit == 255):
        raise ValueError('BG_REGION_BLEND_SUPPORT_MISMATCH')
    if not np.any(edit == 0):
        raise ValueError('BG_REGION_PROTECTED_PIXELS_REQUIRED')
    if not np.any(weight == 255):
        raise ValueError('BG_REGION_255_CORE_REQUIRED')
    return dict(protectedPixels=int(np.count_nonzero(edit == 0)),
                editPixels=int(np.count_nonzero(edit == 255)),
                corePixels=int(np.count_nonzero(weight == 255)),
                transitionPixels=int(np.count_nonzero((weight > 0) & (weight < 255))))


def _png(pixels, profile):
    stream = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    for kind, value in profile['chunks'].items():
        metadata.add(kind, value)
    Image.fromarray(pixels).save(stream, format='PNG', pnginfo=metadata,
                               **({'icc_profile': profile['icc']} if profile['icc'] is not None else {}))
    raw = stream.getvalue()
    if len(raw) > MAX_BYTES:
        raise ValueError('BG_REGION_FILE_SIZE')
    return raw


def _preview(source, edit, weight, profile):
    pixels = source.copy()
    selected = edit == 255
    tint = np.full(source.shape, (255, 160, 0), dtype=np.uint32)
    tint[weight == 255] = (255, 0, 255)
    pixels[selected] = ((source.astype(np.uint32)[selected] + tint[selected] + 1) // 2).astype(np.uint8)
    return _png(pixels, profile)


def _scope(background_mode, text_policy, reason):
    if background_mode not in ('scene-only', 'preserve-underlay') or text_policy != 'remove-business-text':
        raise ValueError('BG_REGION_EXPLICIT_CONTENT_SCOPE_REQUIRED')
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 4096:
        raise ValueError('BG_REGION_REASON_REQUIRED')


def _artifact(name, raw):
    return dict(path=name, sha256=_sha(raw), bytes=len(raw))


def _plan(raws, source, edit, weight, profile, mode, scope):
    plan = dict(kind='ui_background_region_plan_v1', status='frozen_region_plan',
                backgroundMode=scope[0], textPolicy=scope[1], reason=scope[2],
                size=[source.shape[1], source.shape[0]], sourceMode=mode,
                sourceColorProfile=_color_evidence(profile),
                artifacts={name: _artifact(name, raws[name]) for name in FILES},
                counts=_masks(edit, weight), regionPolicy=REGION_POLICY.copy(),
                blendPolicy=BLEND_POLICY.copy(), evidence=EVIDENCE.copy(),
                limits=dict(fileBytes=MAX_BYTES, pixels=MAX_PIXELS, side=MAX_SIDE))
    plan['digest'] = body_digest(plan)
    return plan


def _destination(output, inputs):
    path = _safe_path(output)
    if path.exists() or path.is_symlink():
        raise FileExistsError(path)
    path = path.resolve()
    for item in inputs:
        item = _safe_path(item).resolve()
        if path == item or path in item.parents or item in path.parents:
            raise ValueError('BG_REGION_OUTPUT_INPUT_OVERLAP')
    return path


def _write(path, raw):
    with path.open('xb') as stream:
        stream.write(raw)


def freeze(source, source_sha256, edit_mask, edit_sha256, blend_mask, blend_sha256,
           output, background_mode, text_policy, reason):
    """Freeze explicit masks and source bytes into a fresh, standalone directory."""
    _scope(background_mode, text_policy, reason)
    output = _destination(output, (source, edit_mask, blend_mask))
    raws = {'source.png': _bound(source, source_sha256, 'SOURCE'),
            'edit-mask.png': _bound(edit_mask, edit_sha256, 'EDIT'),
            'blend-mask.png': _bound(blend_mask, blend_sha256, 'BLEND')}
    rgb, size, profile, mode = _decode(raws['source.png'])
    edit, _, _, _ = _decode(raws['edit-mask.png'], mask=True, size=size)
    weight, _, _, _ = _decode(raws['blend-mask.png'], mask=True, size=size)
    _masks(edit, weight)
    raws['preview.png'] = _preview(rgb, edit, weight, profile)
    plan = _plan(raws, rgb, edit, weight, profile, mode, (background_mode, text_policy, reason))
    output.mkdir(parents=True, exist_ok=False)
    for name in FILES:
        _write(output / name, raws[name])
    save(output / 'plan.json', plan)
    return plan


def _json(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('BG_REGION_DUPLICATE_JSON_KEY')
            result[key] = value
        return result

    def invalid(value):
        raise ValueError('BG_REGION_NONFINITE_JSON')

    try:
        return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=pairs, parse_constant=invalid)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('BG_REGION_INVALID_PLAN_JSON') from error


def _inspect(plan_dir, expected_digest):
    _sha_required(expected_digest, 'PLAN')
    root = _safe_path(plan_dir)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('BG_REGION_PLAN_DIRECTORY_REQUIRED')
    paths = list(root.iterdir())
    if {p.name for p in paths} != set(FILES) | {'plan.json'} or any(p.is_symlink() or not p.is_file() for p in paths):
        raise ValueError('BG_REGION_PLAN_FILE_WHITELIST')
    raw_plan = _read(root / 'plan.json', MAX_JSON_BYTES)
    plan = _json(raw_plan)
    if not isinstance(plan, dict) or plan.get('digest') != expected_digest:
        raise ValueError('BG_REGION_PLAN_DIGEST_MISMATCH')
    if body_digest({k: v for k, v in plan.items() if k != 'digest'}) != expected_digest:
        raise ValueError('BG_REGION_PLAN_DIGEST_MISMATCH')
    scope = (plan.get('backgroundMode'), plan.get('textPolicy'), plan.get('reason'))
    _scope(*scope)
    # Never follow user-supplied artifact paths; rebuild the entire permitted schema.
    raws = {name: _read(root / name) for name in FILES}
    rgb, size, profile, mode = _decode(raws['source.png'])
    edit, _, _, _ = _decode(raws['edit-mask.png'], mask=True, size=size)
    weight, _, _, _ = _decode(raws['blend-mask.png'], mask=True, size=size)
    _masks(edit, weight)
    if raws['preview.png'] != _preview(rgb, edit, weight, profile):
        raise ValueError('BG_REGION_DERIVED_PREVIEW_MISMATCH')
    expected = _plan(raws, rgb, edit, weight, profile, mode, scope)
    if body_digest(plan) != body_digest(expected):
        raise ValueError('BG_REGION_PLAN_STRUCTURE_OR_EVIDENCE_MISMATCH')
    return plan, raw_plan, raws, rgb, weight, profile


def inspect(plan_dir, expected_digest):
    """Revalidate all frozen bytes, masks, derived preview and fixed semantics."""
    return _inspect(plan_dir, expected_digest)[0]


def apply(plan_dir, expected_digest, proposal, proposal_sha256, output, *, candidate_mode='RGB'):
    """Make one candidate using exactly the frozen weights, without rescaling."""
    if candidate_mode not in ('RGB', 'RGBA'):
        raise ValueError('BG_REGION_CANDIDATE_MODE')
    output = _destination(output, (plan_dir, proposal))
    plan, raw_plan, raws, source, weight, profile = _inspect(plan_dir, expected_digest)
    proposal_raw = _bound(proposal, proposal_sha256, 'PROPOSAL')
    proposed, _, proposal_profile, _ = _decode(proposal_raw, size=tuple(plan['size']))
    if proposal_profile != profile:
        raise ValueError('BG_REGION_COLOR_PROFILE_MISMATCH')
    w = weight.astype(np.uint32)[:, :, None]
    pixels = ((source.astype(np.uint32) * (255 - w) + proposed.astype(np.uint32) * w + 127) // 255).astype(np.uint8)
    if not np.array_equal(pixels[weight == 0], source[weight == 0]):
        raise ValueError('BG_REGION_PROTECTION_INVARIANT')
    if not np.array_equal(pixels[weight == 255], proposed[weight == 255]):
        raise ValueError('BG_REGION_CORE_INVARIANT')
    encoded = (np.concatenate((pixels, np.full((*pixels.shape[:2], 1), 255, dtype=np.uint8)), axis=2)
               if candidate_mode == 'RGBA' else pixels)
    copied = dict(raws, **{'proposal.png': proposal_raw, 'frozen-plan.json': raw_plan,
                         'candidate.png': _png(encoded, profile)})
    report = dict(kind='ui_background_region_candidate_v1', status='candidate_pending_visual_review',
                  regionDigest=expected_digest, size=plan['size'],
                  backgroundMode=plan['backgroundMode'], textPolicy=plan['textPolicy'], reason=plan['reason'],
                  sourceColorProfile=plan['sourceColorProfile'], counts=plan['counts'],
                  artifacts={name: _artifact(name, raw) for name, raw in copied.items()},
                  regionPolicy=REGION_POLICY.copy(), blendPolicy=BLEND_POLICY.copy(),
                  protectedChangedPixels=0, coreMatchesProposal=True, outputOpaque=True,
                  **EVIDENCE)
    if candidate_mode == 'RGBA':
        report.update(candidateMode='RGBA', candidateEncoding='opaque-RGBA-same-RGB-pixels-v1')
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in copied.items():
        _write(output / name, raw)
    save(output / 'report.json', report)
    return report
