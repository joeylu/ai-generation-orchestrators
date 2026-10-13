"""Ownership-scoped edit rules for opt-in context v16 / board v9.

Historical renderers keep their original wording. These rules change instructions,
not reviewed identities, source pixels, geometry, or acceptance gates.
"""

SCOPE = (
    'FINAL CONTENT FIRST: output only this owner\'s KEEP content. For clean-substrate, '
    'the finished asset is the empty backing surface, its border and explicitly owned '
    'KEEP decorations. Separately owned overlays are absent, including their outlines, '
    'shadows and glow. Continue the same backing texture and opacity beneath their '
    'complete footprints; removing only their text is insufficient. For owned-artwork, '
    'retain every explicitly owned KEEP object, including fixed illustrations and their '
    'depicted subjects. Ownership removal takes priority over reference copying and '
    'layout preservation. Surrounding parent surfaces and neighboring fragments are '
    'reference context, never additional output borders.')

TEXT = (
    'TEXT WITHIN OWNERSHIP: remove ordinary labels, captions and numbers with their '
    'outlines, shadows and glow. preserveText lists the exact permitted text for this '
    'owner; [] permits none. On retained KEEP content, restore the owned surface under '
    'removed text. On foreign overlays, remove the entire overlay, not just its glyphs. '
    'Retain icon pictograms only when explicitly in KEEP, at their original offsets. '
    'A one-character label is not automatically a pictogram. Add no replacement text.')

FIDELITY = (
    'FIDELITY OF KEEP ONLY: preserve the original contours, thin border widths, corner '
    'shapes, texture, colors, state, count, proportions and spacing of retained KEEP '
    'content. Preserve its highlights and soft cast shadows with continuous alpha. '
    'Foreign overlay shadows and parent backing do not belong to KEEP. Add no bevel, '
    'glow, ornament, halo or thicker border. Keep genuine owned openings and translucency. '
    'Do not enlarge or recenter KEEP into cleared space. Scale uniformly, never stretch.')


def finished_role(role):
    if role == 'clean-substrate':
        return ('FINISHED SLOT: empty owned backing, border and KEEP decorations only. '
                'Clear all listed overlays completely and restore the backing beneath them.')
    return ('FINISHED SLOT: all KEEP artwork, including its explicitly owned illustrations '
            'and pictograms. Remove only foreign content and unlicensed text.')
