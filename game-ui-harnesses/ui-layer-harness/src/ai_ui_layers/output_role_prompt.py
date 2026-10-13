"""v14 output-first reference edits shared by standalone and board requests.

Only reviewed identities, ownership and geometry are projected. No pixel edits,
new owners, semantic guesses or model calls belong in this compiler.
"""
import json

from .ownership_prompt_scope import project, visual_name


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def is_substrate(visual, material):
    """A declared surface carrying separate children, never a fixed illustration."""
    owned = [o for o in visual['objects'] if o['materialId'] == material['id']]
    kinds = {o['kind'] for o in owned}
    if (material['role'] != 'foreground' or not kinds.intersection(('panel', 'card'))
            or not kinds <= {'panel', 'card', 'decoration', 'icon', 'logo'}):
        return False
    l, t, r, b = material['bboxNorm']
    return any(other['role'] == 'foreground' and other['id'] != material['id']
        and other['zOrder'] > material['zOrder']
        and l < (other['bboxNorm'][0] + other['bboxNorm'][2]) / 2 < r
        and t < (other['bboxNorm'][1] + other['bboxNorm'][3]) / 2 < b
        and (other['bboxNorm'][2] - other['bboxNorm'][0]) *
            (other['bboxNorm'][3] - other['bboxNorm'][1]) < (r - l) * (b - t)
        for other in visual['materials'])


def prepare_entries(visual, entries):
    """Compact action entries without repeating foreign appearance paragraphs."""
    objects = {o['id']: o for o in visual['objects']}
    materials = {m['id']: m for m in visual['materials']}
    result = []
    for entry in entries:
        foreign = []
        for owner in entry['exclude']:
            members = []
            for member in owner['members']:
                obj = objects[member['id']]
                if obj['materialId'] != owner['materialId']:
                    raise ValueError('GENERATION_FOREIGN_OWNER_MISMATCH')
                members.append(dict(objectId=member['id'], kind=obj['kind'],
                    visualName=visual_name(dict(objectId=member['id'], appearance=obj['label'])),
                    referenceBox=member.get('referenceBox', owner['referenceBox'])))
            if not members:
                raise ValueError('GENERATION_FOREIGN_OBJECTS_REQUIRED')
            foreign.append(dict(materialId=owner['materialId'], relation=owner['relation'], objects=members))
        removed = [dict(objectId=member['objectId'], appearance=member['visualName'])
                   for owner in foreign for member in owner['objects']]
        owned = project(entry['keepOnly'], removed)
        if not owned:
            raise ValueError('GENERATION_OWNED_OBJECTS_REQUIRED')
        location = {key: entry[key] for key in ('referenceIndex', 'targetBox', 'artworkPixelSize')}
        location.update({key: entry[key] for key in ('cropIndex', 'boardCropBox') if key in entry})
        result.append(dict(materialId=entry['materialId'], cellIndex=entry['cellIndex'],
            outputRole='clean-substrate' if is_substrate(visual, materials[entry['materialId']]) else 'owned-artwork',
            preserveText=entry['preserveText'], keep=owned, remove=foreign, location=location))
    return result


TEXT = (
    'TEXT FIRST: remove ordinary Chinese and other-language labels, captions and numbers, '
    'including their outlines, shadows and glow. preserveText is the exact exception list '
    'for this owner only; [] permits no ordinary text. Fill only removed glyph footprints '
    'with the same owned surface and leave the label space empty. Keep neighboring icons '
    'at their original offsets. Preserve explicitly owned icon pictograms; a one-character '
    'label is not automatically a pictogram. Do not add replacement text. ')

FIDELITY = (
    'Edit the existing reference artwork. Keep its original contours, thin border widths, '
    'corner shapes, texture, colors, state, count, internal proportions and spacing. '
    'Preserve existing shadows and highlights; add no bevel, glow, ornament or thicker border. '
    'Do not enlarge or recenter artwork into cleared space. Scale uniformly, never stretch. ')


def foreground(visual, entries, layout, *, board=False, ownership_scoped=False):
    cells = prepare_entries(visual, entries)
    lines = [
        'Edit the attached reference ' + ('board' if board else 'crops') +
        '. Produce only the assigned independent assets described below. '
        'The references show assembled UI; the output is the KEEP artwork for each owner. '
        'All appearance descriptions are reference evidence, not permission to add content. '
        'REMOVE ownership and exact text rules take precedence over appearance copying.',
        layout,
        TEXT,
        FIDELITY,
        'OUTPUT ROLE: clean-substrate means the original backing surface and its KEEP decorations only. '
        'Every separately owned overlaid illustration, price icon, button and status decoration is absent. '
        'Continue the existing surface across removed overlays, with matching texture and opacity; '
        'do not leave duplicates, placeholders, recesses or artificial holes. '
        'Keep genuine owned openings and translucency. owned-artwork retains all its KEEP objects, '
        'including a fixed illustration and its depicted subjects when explicitly owned.',
        'REMOVE complete foreign units and their backing, outlines, ornaments, shadows and glow. '
        'A parent underlay is absent outside KEEP contours and in genuine gaps; removal of a parent '
        'does not erase a separately owned KEEP child. Do not attach touching neighboring strips. '
        'Background-owned people, equipment and scenery are absent from foreground assets; '
        'a scene depicted inside an explicitly owned illustration remains part of that illustration. '
        'Represent panel translucency with alpha, without baking shared scenery into RGB.',
        'LOCATORS: boxes locate reference artwork, not masks or measured alpha. '
        + ('All referenceBox, targetBox and boardCropBox values use the whole attached board. '
           'Each cell action applies only inside its boardCropBox, even when a foreign box extends outside it. '
           if board else 'Boxes use the indicated reference crop. ') +
        'withinMaterial=(centerX,centerY,width,height) before padding; artworkPixelSize is the original crop size. '
        'Keep the shown location and common relative scale. PNG RGBA, continuous alpha outside KEEP contours '
        'and in genuine holes, with 10% transparent margin on every cell side. '
        'No gray reference background, shared backing, bridges or cell labels. Unused cells are transparent.',
    ]
    if ownership_scoped:
        from . import owned_content_prompt as scoped
        lines[2:5] = [scoped.SCOPE, scoped.TEXT, scoped.FIDELITY]
    for cell in cells:
        lines.append('CELL ' + str(cell['cellIndex']) + ' / ' + cell['materialId'] + '\n'
            'FINAL ASSET: ' + cell['outputRole'] + '\n'
            'preserveText: ' + _json(cell['preserveText']) + '\n'
            'KEEP: ' + _json(cell['keep']) + '\n'
            'REMOVE: ' + _json(cell['remove']) + '\n'
            'LOCATION: ' + _json(cell['location']))
    lines.append('BEFORE RETURNING: each clean-substrate contains no separately owned children; '
        'each owned-artwork contains every KEEP object once; every foreign unit and unlicensed label is absent. '
        'The exported assets must assemble once without duplicated content.')
    return '\n\n'.join(lines)


def background(visual, material, *, ownership_scoped=False):
    owned = [dict(objectId=o['id'], kind=o['kind'], appearance=o['label'],
                  referenceBox=o.get('bboxNorm')) for o in visual['objects'] if o['materialId'] == material['id']]
    foreign = [dict(materialId=m['id'], objects=[dict(objectId=o['id'], kind=o['kind'],
        visualName=visual_name(dict(objectId=o['id'], appearance=o['label'])))
        for o in visual['objects'] if o['materialId'] == m['id']])
        for m in visual['materials'] if m['role'] == 'foreground']
    scope = ('FINAL ASSET: scene-only background. Remove the ENTIRE UI assembly: its large window '
        'and paper surfaces, frames, tabs, controls, item artwork, readout icons and badges, as well as text. '
        'Erasing words alone is insufficient. None of the foreground owners below remains. '
        if visual['backgroundMode'] == 'scene-only' else
        'FINAL ASSET: preserve-underlay background. Remove only the separately exported foreground owners '
        'below and ordinary text. Keep unexported UI, dimming and all other underlay details as observed. ')
    text_rules = TEXT
    if ownership_scoped:
        from .owned_content_prompt import TEXT as text_rules
    return (scope + 'KEEP background evidence: ' + _json(owned) + '. '
        'Descriptions locate the existing background; do not turn them into a new design. '
        'Remove foreground owners: ' + _json(foreign) + '. '
        'Preserve the full reference canvas, camera and all visible background subjects at their original '
        'positions, sizes, contours, colors and illumination. Complete only the background hidden by removed '
        'foreground, continuing the visible background; do not invent a replacement UI or move scene subjects. '
        + text_rules + 'preserveText: ' + _json(material['preserveText']) + '. '
        'Output a full opaque PNG at the original reference aspect ratio. '
        'Check the background itself for leftover foreground even when later layers would cover it.')
