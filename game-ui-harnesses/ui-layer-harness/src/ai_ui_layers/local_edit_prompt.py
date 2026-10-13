"""Board v10: concise local edits projected from reviewed ownership evidence."""
import json
from .output_role_prompt import prepare_entries
from .cell_locked_prompt import local_actions


CONTOUR_SCOPE = (
    'For each empty backing, follow its own existing closed thin border: the retained '
    'surface ends at that border, with its original soft shadow just outside it. '
    'Paper or parent backing beyond that border is removed, even when its color matches '
    'the inside. Do not turn the rectangular reference crop into the asset silhouette '
    'or add a second outer frame. Keep any explicitly listed owned protruding decoration.')


def foreground(visual, entries, size, grid, *, contour_scope=False):
    cells = prepare_entries(visual, entries)
    columns, rows = grid
    if not cells or columns * rows < len(cells):
        raise ValueError('CELL_LOCKED_GRID')
    lines = [
        f'Locally edit the attached reference board. Keep {len(cells)} separate assets in '
        f'the same {columns}-column, {rows}-row arrangement and {size[0]}:{size[1]} aspect ratio.',
        'Use the existing artwork, not a redesigned replacement. Preserve each retained '
        'surface, original thin border, corner shape, ornament, texture and soft shadow. '
        'Keep its original size and position within its cell; do not standardize similar assets.',
        'For an empty backing, remove the listed overlays completely, including their shadows, '
        'and continue the original backing beneath them. For retained artwork, keep all its '
        'listed subjects. Remove ordinary text except exact text explicitly allowed below; '
        'restore the surface beneath removed text.',
        'Remove the gray board backing, surrounding parent surfaces and neighboring fragments. '
        'Outside each retained asset and its own soft shadow, use fully transparent alpha, '
        'including clean gaps between cells. Keep original surface opacity. Output one RGBA PNG.',
        'Read cells left to right, then top to bottom. Target boxes locate the retained asset '
        'in the whole reference board; they are locators, not rectangular cutout masks.'
    ]
    if contour_scope:
        lines.insert(2,CONTOUR_SCOPE)
    for cell in cells:
        overlays = [a['visualName'] for a in local_actions(cell) if a['relation']=='overlay']
        # Retain each distinct visible removal target. Do not reinterpret labels or
        # infer a new ownership graph while compressing its presentation.
        overlays = list(dict.fromkeys(overlays))
        row = dict(cell=cell['cellIndex']+1,
            target=cell['location']['targetBox'],
            result='empty backing' if cell['outputRole']=='clean-substrate' else 'retained artwork',
            keep=[o['appearance'] for o in cell['keep']],
            removeOverlays=overlays,allowedText=cell['preserveText'])
        lines.append(json.dumps(row,ensure_ascii=False,separators=(',', ':')))
    return '\n\n'.join(lines)
