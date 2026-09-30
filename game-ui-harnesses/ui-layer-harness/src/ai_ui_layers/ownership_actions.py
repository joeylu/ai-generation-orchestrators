"""Render frozen sheet ownership as adjacent actions, without inference or models."""
import json


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def board_prompt(entries, size, grid):
    width, height = size
    columns, rows = grid
    header = (
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
    sections = []
    for entry in entries:
        location = {key: entry[key] for key in
                    ('referenceIndex', 'cropIndex', 'boardCropBox', 'targetBox', 'artworkPixelSize')}
        keep = {key: entry[key] for key in ('artwork', 'parts', 'surface') if key in entry}
        sections.append(
            f'Cell {entry["cellIndex"]} / {entry["materialId"]}\n'
            'KEEP: ' + _json(keep) + '\n'
            'REMOVE complete foreign units, including backing, frames and ornaments: '
            + _json(entry['exclude']) + '\n'
            'AFTER REMOVAL: continue KEEP surface through covered footprints; no holes/ghosts/placeholders; '
            'retain genuine openings and translucency.\n'
            'TEXT: remove ordinary letters/numbers except this exact preserveText list: '
            + _json(entry['preserveText']) + '. Retain owned single-character icon pictograms. '
            'Restore surface under removed glyphs; keep other parts fixed.\n'
            'LOCATION: ' + _json(location))
    return header + '\n\n'.join(sections) + '\n'
