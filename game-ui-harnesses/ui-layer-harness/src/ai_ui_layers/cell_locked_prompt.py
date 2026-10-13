"""Opt-in board v8: independent output slots and crop-local action projection.

The reviewed ownership graph remains authoritative and unchanged. Intersections
are reference locators only; they never become image masks or inferred artwork.
"""
import json

from .output_role_prompt import prepare_entries, TEXT, FIDELITY


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def local_actions(cell):
    """Only describe the portion of foreign evidence visible in this crop."""
    crop = cell['location']['boardCropBox']
    actions = []
    for owner in cell['remove']:
        for obj in owner['objects']:
            box = obj['referenceBox']
            intersection = [max(crop[0], box[0]), max(crop[1], box[1]),
                            min(crop[2], box[2]), min(crop[3], box[3])]
            if intersection[0] >= intersection[2] or intersection[1] >= intersection[3]:
                continue
            actions.append(dict(objectId=obj['objectId'], visualName=obj['visualName'],
                relation=owner['relation'], visibleReferenceBox=intersection))
    return actions


def foreground(visual, entries, size, grid, *, ownership_scoped=False):
    cells = prepare_entries(visual, entries)
    width, height = size
    columns, rows = grid
    if not cells or columns * rows < len(cells):
        raise ValueError('CELL_LOCKED_GRID')
    slots = [dict(cellIndex=c['cellIndex'], row=c['cellIndex']//columns+1,
        column=c['cellIndex']%columns+1, materialId=c['materialId'],
        outputRole=c['outputRole'], targetBox=c['location']['targetBox']) for c in cells]
    structure = (f'OUTPUT STRUCTURE: exactly {len(cells)} independent complete assets in ONE '
        f'transparent RGBA sheet, {columns} columns by {rows} rows, row-major, aspect {width}:{height}. '
        'Keep the attached board layout. Each occupied slot contains its own complete assigned asset. '
        'Repeated similar cards are separate outputs: retain every instance, never deduplicate or merge '
        'them into one large panel. No common surface, enclosing frame or glow may connect slots. '
        'Leave continuous fully transparent gutters between rows and columns and 10% transparent '
        'margin on every cell side. Unused slots remain transparent. If output resolution changes, '
        'scale the entire sheet uniformly and preserve its aspect ratio and relative asset sizes. '
        'Never enlarge a single asset to fill the sheet or cleared space.')
    lines = [structure, 'OUTPUT SLOTS: '+_json(slots),
        'Edit the reference artwork inside each slot independently. The attachment contains context '
        'around each owned asset; its gray backing and surrounding UI are not output artwork. '
        'Source descriptions such as top/right refer to the original scene, never a different output slot. '
        'All boxes below locate evidence in the whole attached board; they are not alpha masks.',
        TEXT, FIDELITY,
        'Retain the original soft cast shadow as part of each asset, with continuous alpha; do not '
        'replace it with a hard cutout or an added halo. Keep genuine openings and translucency.',
        'FINISHED CONTENT: a clean-substrate slot is its own empty backing surface, border and KEEP '
        'decorations. Restore that same surface beneath separately owned overlays, matching texture '
        'and opacity. An owned-artwork slot retains every KEEP object, including any explicitly owned '
        'fixed illustration and its subjects. In either case retain original internal arrangement.',
        'Each action below applies ONLY to the named slot. Context locators show visible portions of '
        'parent or neighboring artwork, not deletion rectangles. Discard parent backing outside KEEP '
        'contours and in genuine holes without erasing the owned asset. Remove visible neighboring '
        'fragments. Never apply one slot\'s actions to another slot, even if an object name repeats.']
    if ownership_scoped:
        from . import owned_content_prompt as scoped
        # Preserve the v8 renderer exactly. Replace its conflicting global edit
        # rules as one block, before any per-cell ownership evidence.
        lines[3:7] = [scoped.SCOPE, scoped.TEXT, scoped.FIDELITY]
    for cell in cells:
        actions = [{k:v for k,v in action.items() if k!='objectId'} for action in local_actions(cell)]
        overlays = [a for a in actions if a['relation']=='overlay']
        context = [a for a in actions if a['relation']!='overlay']
        lines.extend([
            f"SLOT {cell['cellIndex']} / {cell['materialId']}: ONE complete {cell['outputRole']}.",
            *([scoped.finished_role(cell['outputRole'])] if ownership_scoped else []),
            'KEEP: '+_json(cell['keep']),
            'preserveText: '+_json(cell['preserveText']),
            'LOCATION: '+_json(cell['location']),
            'CLEAR OVERLAYS IN THIS SLOT ONLY: '+_json(overlays),
            'DISCARD SURROUNDING CONTEXT IN THIS SLOT ONLY: '+_json(context),
        ])
    lines.extend([f'FINAL STRUCTURE CHECK: {len(cells)} separate complete assets; '
        f'{columns} columns by {rows} rows; aspect {width}:{height}; row-major owners: '+
        _json([c['materialId'] for c in cells])+'. No merged panel or deduplicated representative.',
        'Check every occupied slot independently: complete assigned contour and shadow, correct KEEP '
        'content once, no foreign overlay or unlicensed text. Check all gutters are transparent. '
        'Return the complete multi-asset sheet, not a single representative asset.'])
    return '\n\n'.join(lines)
