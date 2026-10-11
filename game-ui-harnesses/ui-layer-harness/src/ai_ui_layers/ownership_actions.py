"""Render frozen sheet ownership as adjacent actions, without inference or models."""
import json

SCENE_REMOVAL = ('BACKGROUND OWNERSHIP: remove background people and their clothing/equipment, scenery and other '
    'scene pixels from every foreground cell, including portions inside connecting lines or visible through '
    'translucent plates. Keep only the explicitly assigned KEEP artwork; an owned illustration retains its '
    'own depicted subjects. Background scene subjects remain in the separately exported background only. '
    'Apply this removal only within this cell crop, never to another cell or the background export.')


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def board_prompt(entries, size, grid, *, edit_only=False, exclude_scene=False,
                 explicit_text_removal=False):
    width, height = size
    columns, rows = grid
    header = (('Edit the attached reference board: remove unnecessary elements, keep only each cell\'s '
        'original KEEP subject and preserve its appearance. Descriptions identify reference content; '
        'they are not instructions to add artwork. ' if edit_only else '')+
        'Output only KEEP artwork per cell. REMOVE overrides reference copying and descriptions; '
        'omit assembled foreign controls. '
        f'One attached board; aspect {width}:{height}, grid {columns} columns by {rows} rows, '
        'row-major; unused cells empty. Whole-board normalized boxes are locators, not masks. '
        'Each REMOVE applies inside its boardCropBox; it cannot delete another cell\'s KEEP. '
        'Preserve KEEP contours, appearance, state, internal offsets, shown positions and common scale. '
        'Scale the whole board uniformly if pixels differ; no stretch, recentering or enlargement '
        'into removed space. artworkPixelSize=planned crop size, not measured alpha bounds; '
        'withinMaterial=(centerX,centerY,width,height) before padding. '
        'PNG with true continuous alpha outside KEEP contours and in genuine gaps; retain owned '
        'translucency without source context or gray board background. 10% transparent margin '
        'within each cell. No new borders, glow, decoration or shared backing.\n')
    if exclude_scene:
        header += SCENE_REMOVAL + '\n'
    sections = []
    for entry in entries:
        location = {key: entry[key] for key in
                    ('referenceIndex', 'cropIndex', 'boardCropBox', 'targetBox', 'artworkPixelSize')}
        keep = {key: entry[key] for key in ('artwork', 'parts', 'surface') if key in entry}
        text = ('TEXT: remove ordinary letters/numbers except this exact preserveText list: '
            + _json(entry['preserveText']) + '. Retain owned single-character icon pictograms. '
            + ('Keep text space empty and other parts fixed.\n' if edit_only else
               'Restore surface under removed glyphs; keep other parts fixed.\n'))
        if explicit_text_removal:
            text = ('TEXT REMOVE overrides KEEP descriptions and appearance copying. '
                '去掉普通中文及其他语言的标签、文字和数字，以及文字的描边、阴影和发光。'
                'Exact preserveText exceptions for THIS cell only: '
                + _json(entry['preserveText']) + '. An empty list permits no ordinary text. '
                'Keep the text area empty; retain the original surface, contours and non-text artwork. '
                'Retain owned icon pictograms; a label is not an icon merely because it has one character. '
                'Do not copy text from another cell or add replacement text.\n')
        sections.append(
            f'Cell {entry["cellIndex"]} / {entry["materialId"]}\n'
            + (text if explicit_text_removal else '') +
            'KEEP: ' + _json(keep) + '\n'
            'REMOVE complete foreign units, including backing, frames and ornaments: '
            + _json(entry['exclude']) + '\n'
            + ('AFTER REMOVAL: keep the original owned subject, its contours, openings and translucency.\n'
               if edit_only else
               'AFTER REMOVAL: continue KEEP surface through covered footprints; no holes/ghosts/placeholders; '
               'retain genuine openings and translucency.\n')+
            ('' if explicit_text_removal else text) +
            'LOCATION: ' + _json(location))
    return header + '\n\n'.join(sections) + '\n'
