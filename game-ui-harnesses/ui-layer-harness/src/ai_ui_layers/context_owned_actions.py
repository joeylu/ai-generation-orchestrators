"""Ownership-first generation instructions; no label rewriting or pixel inference."""
import json


OWNERSHIP_PRIORITY = (
    'The DELETE list overrides reference copying and every appearance description, including '
    'descriptions in KEEP that mention an assembled control. An ownership box is not permission '
    'to copy everything inside it. A description never transfers ownership. '
    'A DELETE object does not include a separately assigned KEEP object merely because they overlap; '
    'preserve every KEEP identity and its genuine contours.')
FOREIGN_REMOVAL_RULES = (
    'Overlay removal: continue only the existing owned surface behind the removed unit. '
    'Leave no duplicate, empty frame, placeholder, recess, ghost or artificial hole. '
    'Underlay removal: omit the foreign backing outside owned contours and in genuine gaps; '
    'do not copy a parent track, card or panel as part of its independent child. '
    'Same-depth removal: omit the foreign unit without inventing hidden owned artwork.')


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def build(visual, entries, layout, group=None):
    """Keep appearance evidence for owners, never promote foreign prose to drawing text.

    Every foreign object retains its owner, identity, kind and reference locator.
    Repeated instances are not deduplicated. Reference boxes remain locators.
    """
    objects = {obj['id']: obj for obj in visual['objects']}
    lines = [
        'OWNERSHIP FIRST. Generate only the assigned independent material in each cell.',
        OWNERSHIP_PRIORITY,
        layout,
        'Each DELETE applies only inside its own cell; never delete another cell\'s KEEP. '
        'Identical-looking objects with separate IDs are distinct instances; keep their individual assignments. '
        'Use one common uniform scale for a sheet; unused cells must remain fully transparent.',
    ]
    for entry in entries:
        removed = []
        for owner in entry['exclude']:
            if not owner['members']:
                raise ValueError('GENERATION_FOREIGN_OBJECTS_REQUIRED')
            for member in owner['members']:
                obj = objects[member['id']]
                if obj['materialId'] != owner['materialId']:
                    raise ValueError('GENERATION_FOREIGN_OWNER_MISMATCH')
                removed.append(dict(materialId=owner['materialId'], objectId=member['id'],
                    kind=obj['kind'], relation=owner['relation'],
                    referenceBox=member.get('referenceBox', owner['referenceBox'])))
        if not entry['keepOnly']:
            raise ValueError('GENERATION_OWNED_OBJECTS_REQUIRED')
        lines.extend([
            f'CELL {entry["cellIndex"]}; attached reference {entry["referenceIndex"]}; owner {entry["materialId"]}.',
            'DELETE every listed foreign unit completely, including its body, backing, frame, '
            'contents, ornaments, outline, shadow and glow. Removing its text alone is insufficient.',
            *['DELETE '+_json(item) for item in removed],
            FOREIGN_REMOVAL_RULES,
            'KEEP exactly these owned objects; preserve their appearance only within this ownership scope:',
            *['KEEP '+_json(part) for part in entry['keepOnly']],
        ])
        if group:
            columns=group['grid'][0];index=entry['cellIndex']
            lines.append(f'Cell {index} uses zero-based column {index%columns}, row {index//columns}.')
        if entry['surface'] == 'continuous-panel':
            lines.append('CLEAN PLATE: render the owned substrate and explicitly owned decorations only. '
                         'All separately assigned children must be absent. Restore the existing surface '
                         'through their footprints; retain genuine owned openings and translucency.')
        lines.extend([
            'TEXT: remove ordinary labels and numbers except this exact preserveText list: '+
            _json(entry['preserveText'])+'. Retain owned single-character icon pictograms. '
            'Fill removed glyphs with owned surface, keep text space empty and other parts fixed.',
            'LOCATION: '+_json({key: entry[key] for key in
                ('targetBox', 'artworkPixelSize')}),
            'FINAL CONTENT CHECK: every DELETE unit is absent, every KEEP object is complete, '
            'and no foreign frame, control, icon, backing or shadow has been copied from the reference.',
        ])
    lines.append('Preserve owned identity, state, count, complete contours, proportions, internal offsets, '
        'texture, gradients and highlights. No recentering, enlargement, redesign or new decoration. '
        'targetBox/referenceBox are local normalized locators, not masks or measured alpha bounds; '
        'artworkPixelSize is the planned crop size. withinMaterial=(centerX,centerY,width,height) before padding. '
        'Output PNG with true continuous alpha outside owned contours and in genuine gaps; preserve owned '
        'translucency without scene or foreign backing. Keep 10% fully transparent margin on every side. '
        'Use one uniform x/y scale, never stretch. No cell labels, shared backing or added borders/glow.')
    return '\n'.join(lines)
