"""Deterministic, bounded single-board reference for a reviewed context sheet."""

import hashlib
import io
import json
import math
from pathlib import Path

from PIL import Image

from . import context_references
from .evaluate import read
from .execution_preflight import preflight
from .visual_policy import snapshot_policy, generation_guidance
from .visual_textures import snapshot_input, snapshot_bindings


KIND = 'ui_sheet_layout_reference_v1'
MODE = 'sheet-layout-board'
ROOT = 'sheet-layout'
BOARD = ROOT + '/board.png'
METADATA = ROOT + '/board.json'
PROMPT = ROOT + '/prompt.txt'
NEUTRAL_GRAY = (128, 128, 128, 255)


def _bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _norm(box, size):
    width, height = size
    return [round(box[0] / width, 8), round(box[1] / height, 8),
            round(box[2] / width, 8), round(box[3] / height, 8)]


def _map_box(box, placement, crop_size, board_size):
    x, y = placement
    scale = crop_size[2]
    crop_width, crop_height = crop_size[:2]
    return _norm([x + box[0] * crop_width * scale,
                  y + box[1] * crop_height * scale,
                  x + box[2] * crop_width * scale,
                  y + box[3] * crop_height * scale], board_size)


def _frozen(snapshot, row):
    manifest = read(snapshot / 'snapshot.json')
    preflight(snapshot, manifest['digest'])
    requests = read(snapshot / 'requests.json')
    from .generation_groups import maximum_members
    group_document=read(snapshot / 'generation-groups.json')
    if (requests.get('generationReference') != 'context-crops' or
            row not in requests['requests'] or
            row.get('kind') != 'sheet' or
            row.get('generationReference') != 'context-crops' or
            not 2 <= len(row.get('materialIds', [])) <= maximum_members(group_document['policy']) or
            len(row['materialIds']) != len(set(row['materialIds'])) or
            [r['materialId'] for r in row['references']] != row['materialIds']):
        raise ValueError('SHEET_LAYOUT_CONTEXT_REQUIRED')
    group = next((g for g in group_document['groups']
                  if g['id'] == row['asset']), None)
    if group is None or group.get('mode') != 'sheet':
        raise ValueError('SHEET_LAYOUT_GROUP_REQUIRED')
    visual_path = snapshot / 'evidence/revised-visual-plan.json'
    if not visual_path.exists():
        visual_path = snapshot / 'evidence/m1-draft.json'
    return manifest, read(visual_path), read(snapshot / 'execution-plan.candidate.json')


def build(snapshot: Path, row: dict, *, prompt_version='v1') -> tuple[dict, bytes, str]:
    """Rebuild canonical metadata, PNG and prompt entirely from a frozen snapshot."""
    if prompt_version not in ('v1', 'v2'):
        raise ValueError('SHEET_LAYOUT_PROMPT_VERSION')
    snapshot = Path(snapshot)
    manifest, visual, plan = _frozen(snapshot, row)
    texture_doc=snapshot_input(snapshot,manifest)
    texture_bindings=None
    if texture_doc is not None:
        if manifest.get('policy')!='deferred-visual-candidate-plan-v1':
            raise ValueError('VISUAL_TEXTURE_VARIANTS_UNSUPPORTED')
        if prompt_version!='v2':raise ValueError('TEXTURE_SHEET_LAYOUT_PROMPT_V2_REQUIRED')
        texture_bindings=snapshot_bindings(snapshot,manifest,visual)
    policy=snapshot_policy(snapshot,manifest)
    width, height = row['outputSize']
    columns, rows = row['grid']
    if columns * rows < len(row['materialIds']) or min(width, height, columns, rows) < 1:
        raise ValueError('SHEET_LAYOUT_GRID')
    cells = []
    for i, reference in enumerate(row['references']):
        col, line = i % columns, i // columns
        left, right = col * width // columns, (col + 1) * width // columns
        top, bottom = line * height // rows, (line + 1) * height // rows
        pad = math.ceil(.10 * min(right - left, bottom - top))
        crop_width, crop_height = reference['referenceSize']
        available_width = right - left - 2 * pad
        available_height = bottom - top - 2 * pad
        scale = min(available_width // crop_width, available_height // crop_height)
        if scale < 1:
            raise ValueError('SHEET_LAYOUT_NO_INTEGER_FIT')
        cells.append((reference, [left, top, right, bottom], pad, scale))
    # A common integer factor preserves every context crop's pixels and relative size.
    scale = min(item[3] for item in cells)
    board = Image.new('RGBA', (width, height), NEUTRAL_GRAY)
    metadata_cells = []
    for i, (reference, cell, pad, _) in enumerate(cells):
        crop_path = snapshot / reference['reference']
        if crop_path.is_symlink():
            raise ValueError('SHEET_LAYOUT_SOURCE_SYMLINK')
        with Image.open(crop_path) as opened:
            crop = opened.convert('RGBA')
        crop_width, crop_height = crop.size
        if [crop_width, crop_height] != reference['referenceSize']:
            raise ValueError('SHEET_LAYOUT_CROP_SIZE')
        scaled_width, scaled_height = crop_width * scale, crop_height * scale
        x = cell[0] + (cell[2] - cell[0] - scaled_width) // 2
        y = cell[1] + (cell[3] - cell[1] - scaled_height) // 2
        placement = [x, y, x + scaled_width, y + scaled_height]
        if (placement[0] < cell[0] + pad or placement[1] < cell[1] + pad or
                placement[2] > cell[2] - pad or placement[3] > cell[3] - pad):
            raise ValueError('SHEET_LAYOUT_PADDING')
        # No alpha mask: the crop's RGBA samples are copied, including genuine gaps.
        board.paste(crop.resize((scaled_width, scaled_height), Image.Resampling.NEAREST), (x, y))
        metadata_cells.append(dict(cellIndex=i, materialId=reference['materialId'],
                                   reference=reference['reference'],
                                   cropSha256=reference['sha256'],
                                   originalSourceSha256=reference['sourceSha256'],
                                   cropRegion=reference['cropRegion'],
                                   cropSize=reference['referenceSize'],
                                   sourceTargetBox=reference['targetBox'],
                                   cellBox=cell, padding=pad, integerScale=scale,
                                   boardCropBox=placement,
                                   boardCropBoxNorm=_norm(placement, (width, height))))
    metadata = dict(kind=KIND, policy='common-integer-context-grid-v1',
                    snapshotDigest=manifest['digest'], requestAsset=row['asset'],
                    grid=row['grid'], outputSize=row['outputSize'],
                    background=list(NEUTRAL_GRAY), materialIds=row['materialIds'],
                    integerScale=scale, cells=metadata_cells)
    if policy is not None:metadata['visualPolicySha256']=manifest['visualPolicySha256']
    texture_regions=[]
    if texture_doc is not None:
        source_sha=_sha((snapshot/'reference.png').read_bytes())
        if (texture_doc['referenceSha256']!=source_sha
                or texture_bindings['referenceSha256']!=source_sha):
            raise ValueError('SHEET_LAYOUT_TEXTURE_SOURCE_MISMATCH')
        owned_cells={cell['materialId']:cell for cell in metadata_cells}
        for region in texture_bindings['regions']:
            cell=owned_cells.get(region['materialId'])
            if cell is None:continue
            crop=cell['cropRegion'];box=region['sourceBox']
            if (cell['originalSourceSha256']!=source_sha or
                    not crop[0]<=box[0]<box[2]<=crop[2] or not crop[1]<=box[1]<box[3]<=crop[3]):
                raise ValueError('SHEET_LAYOUT_TEXTURE_OUTSIDE_CONTEXT')
            board_box=[cell['boardCropBox'][i%2]+(box[i]-crop[i%2])*cell['integerScale'] for i in range(4)]
            placement=cell['boardCropBox']
            if not (placement[0]<=board_box[0]<board_box[2]<=placement[2]
                    and placement[1]<=board_box[1]<board_box[3]<=placement[3]):
                raise ValueError('SHEET_LAYOUT_TEXTURE_BOARD_BOUNDS')
            texture_regions.append(dict(regionId=region['id'],materialId=region['materialId'],
                objectId=region['objectId'],sourceBox=box,boardBox=board_box,boardBoxNorm=_norm(board_box,(width,height)),
                appearance=region['appearance'],protectedArtwork=region['protectedArtwork']))
        metadata.update(textureMappingPolicy='source-bound-integer-board-textures-v1',
            originalReferenceSha256=source_sha,visualTexturesSha256=manifest['visualTexturesSha256'],
            visualTextureBindingsSha256=manifest['visualTextureBindingsSha256'],textureRegions=texture_regions,
            newTextureReviewPerformed=False,planningReviewDeferred=True)
    materials = {m['id']: m for m in visual['materials']}
    assets = {a['id']: a for a in plan['assets']}
    entries = []
    for i, (reference, item) in enumerate(zip(row['references'], metadata_cells)):
        key = reference['materialId']
        entry = context_references.entry(visual, materials[key], assets[key], reference,
                                         plan['canvas'], i,
                                         include_exclusion_details=prompt_version == 'v2')
        placement = item['boardCropBox'][:2]
        crop_size = [*reference['referenceSize'], scale]
        entry['referenceIndex'] = 1
        entry['cropIndex'] = i + 1
        entry['boardCropBox'] = item['boardCropBoxNorm']
        entry['targetBox'] = _map_box(entry['targetBox'], placement, crop_size, (width, height))
        for part in entry['parts']:
            if 'referenceBox' in part:
                part['referenceBox'] = _map_box(part['referenceBox'], placement,
                                                crop_size, (width, height))
        for excluded in entry['exclude']:
            excluded['referenceBox'] = _map_box(excluded['referenceBox'], placement,
                                                crop_size, (width, height))
        entries.append(entry)
    surface = ('For continuous-panel, fill removed foreign footprints with matching panel surface, '
               'preserving genuine openings and translucency. ' if any(
                   e['surface'] == 'continuous-panel' for e in entries) else '')
    prompt = (
        'Edit the attached source-layout board; keep each material at its shown position, size '
        'and contour relative to the whole board. Outside the crops, the board is opaque neutral '
        'gray; do not copy that background into output. CropIndex follows row-major cellIndex '
        'order; every '
        'referenceIndex is 1 because there is one attachment. boardCropBox, targetBox and '
        'referenceBox are normalized to the entire board. boardCropBox locates the context crop; '
        'targetBox locates owned artwork within it. Boxes identify ownership, not masks. '
        'Each entry and its exclusions apply only inside its boardCropBox; referenceBox may extend '
        'beyond that crop and never authorizes deleting another cell\'s assigned material. '
        f'Output one transparent RGBA sheet at aspect {width}:{height}, grid {columns} columns '
        f'by {rows} rows. Put one complete assigned material in each specified cell; unused cells '
        'stay empty. Preserve parts, appearance, internal offsets, state, source proportions and '
        'the common relative scale. If output pixels differ, scale the whole board uniformly, '
        'preserving aspect; never apply a separate material scale. Do not stretch, recenter, '
        'restyle or enlarge individual parts, including into cleared text space. '
        'Remove ordinary business letters and numbers except exact preserveText; keep owned icon '
        'SINGLE-CHARACTER pictograms. Restore only the underlying surface where glyphs are removed. Exclude listed '
        'foreign units completely, including their backing and ornaments. Exclusions override '
        'decoration descriptions. ' + surface +
        'Use true continuous alpha outside complete contours and in genuine gaps; preserve owned '
        'translucency without the gray background or underlying source scene/context. Keep at least '
        '10% fully transparent margin within each cell. No shared backing, bridges, grid marks, labels, new borders, '
        'glow, added decoration or invented artwork. Entries: ' +
        json.dumps(entries, ensure_ascii=False, separators=(',', ':')) + '\n')
    if prompt_version == 'v2':
        from .ownership_actions import board_prompt
        prompt = board_prompt(entries, (width, height), (columns, rows))
    if policy is not None:prompt=prompt.rstrip('\n')+generation_guidance(policy)+'\n'
    if texture_doc is not None:
        prompt=prompt.rstrip('\n')+'\nSource-bound raster textures on this board only: '
        prompt+=('Each boardBoxNorm is normalized to the entire attached layout board, not original context coordinates. '
                 'Preserve the assigned material/object marks inside each locator: exact count, relative layout, '
                 'ink shapes, color and raster appearance. Do not infer or guess unreadable letters with OCR. '
                 'Only these owned texture regions are licensed; never copy marks from another cell. '
                 'Existing exact preserveText lettering licenses remain in force; remove ordinary business '
                 'letters and numbers elsewhere under the ownership actions. These coordinates identify '
                 'appearance evidence, not masks or a new visual-review approval. Texture regions: ')
        prompt_regions=[{key:region[key] for key in ('regionId','materialId','objectId','boardBoxNorm',
                        'appearance','protectedArtwork')} for region in texture_regions]
        prompt+=json.dumps(prompt_regions,ensure_ascii=False,separators=(',',':'))+'\n'
    buffer = io.BytesIO()
    board.save(buffer, format='PNG')
    return metadata, buffer.getvalue(), prompt


def _descriptor(metadata, board_bytes, prompt, prompt_version='v1'):
    payloads = {BOARD: board_bytes, METADATA: _bytes(metadata), PROMPT: prompt.encode('utf-8')}
    return dict(kind=KIND, mode=MODE, snapshotDigest=metadata['snapshotDigest'],
                requestAsset=metadata['requestAsset'], board=BOARD, metadata=METADATA,
                prompt=PROMPT, sha256={name: _sha(payload) for name, payload in payloads.items()},
                **({'visualPolicySha256':metadata['visualPolicySha256']} if 'visualPolicySha256' in metadata else {}),
                **({key:metadata[key] for key in ('textureMappingPolicy','originalReferenceSha256',
                    'visualTexturesSha256','visualTextureBindingsSha256')} if 'textureMappingPolicy' in metadata else {}),
                **({'promptVersion': prompt_version} if prompt_version != 'v1' else {}))


def materialize(job: Path, snapshot: Path, row: dict, *, prompt_version='v2') -> dict:
    """Write one fresh, fixed-path board without touching the frozen snapshot."""
    job = Path(job)
    metadata, board_bytes, prompt = build(snapshot, row, prompt_version=prompt_version)
    descriptor = _descriptor(metadata, board_bytes, prompt, prompt_version)
    folder = job / ROOT
    folder.mkdir(exist_ok=False)
    (job / BOARD).write_bytes(board_bytes)
    (job / METADATA).write_bytes(_bytes(metadata))
    (job / PROMPT).write_bytes(prompt.encode('utf-8'))
    return descriptor


def verify(job: Path, snapshot: Path, row: dict, descriptor: dict) -> None:
    """Compare canonical bytes, including PNG pixels and prompt, not stored hashes alone."""
    job = Path(job)
    if not isinstance(descriptor, dict):
        raise ValueError('SHEET_LAYOUT_DESCRIPTOR_CHANGED')
    prompt_version = descriptor.get('promptVersion', 'v1')
    metadata, board_bytes, prompt = build(snapshot, row, prompt_version=prompt_version)
    expected = _descriptor(metadata, board_bytes, prompt, prompt_version)
    if descriptor != expected:
        raise ValueError('SHEET_LAYOUT_DESCRIPTOR_CHANGED')
    folder = job / ROOT
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('SHEET_LAYOUT_PATH_CHANGED')
    for name, content in ((BOARD, board_bytes), (METADATA, _bytes(metadata)),
                          (PROMPT, prompt.encode('utf-8'))):
        path = job / name
        if path.is_symlink() or not path.is_file() or path.read_bytes() != content:
            raise ValueError('SHEET_LAYOUT_ARTIFACT_CHANGED:' + name)
