"""Fixed enclosed-hole alpha fusion. No colour, filename, model or I/O routing.

An auxiliary false-negative inside a solid decoration can still remove material.
This rule is not semantic proof that a selected region is background.
"""
import numpy as np
from ..canonical import canonical_sha256

PROFILE = {
    'id': 'enclosed_isnet_alpha_v1', 'foreground_threshold': 192,
    'connectivity': 8, 'minimum_area': 9, 'maximum_area_fraction': 0.05,
    'primary_enclosure_minimum': 0.9, 'minimum_gain': 64,
    'feather_per_1024': 3, 'rounding': 'nearest_even',
    'source_transparency': 'bypass_fusion',
}

def inspect_fusion_runtime():
    import importlib.util
    if importlib.util.find_spec('scipy') is None:
        raise ValueError('reference_fusion_runtime_missing')

def fuse_masks(base, auxiliary, source_alpha):
    if any(a.dtype != np.uint8 for a in (base, auxiliary, source_alpha)):
        raise ValueError('reference_fusion_uint8_required')
    if base.ndim != 2 or base.shape != auxiliary.shape or base.shape != source_alpha.shape or not base.size:
        raise ValueError('reference_fusion_shape_invalid')
    evidence = {'profile': dict(PROFILE), 'profile_sha256': canonical_sha256(PROFILE),
                'components': [], 'changed_pixels': 0, 'source_alpha_bypass': bool(np.any(source_alpha < 255))}
    out = base.copy()
    if evidence['source_alpha_bypass']:
        return out, evidence
    inspect_fusion_runtime()
    from scipy import ndimage as ndi
    structure = np.ones((3, 3), dtype=bool)
    foreground = auxiliary >= 192
    holes = ndi.binary_fill_holes(foreground, structure=structure) & ~foreground
    labels, _count = ndi.label(holes, structure=structure)
    width = max(1.0, min(base.shape) / 1024 * 3)
    for ident, sl in enumerate(ndi.find_objects(labels), start=1):
        if sl is None:
            continue
        y, x = sl
        ys = slice(max(0, y.start - 1), min(base.shape[0], y.stop + 1))
        xs = slice(max(0, x.start - 1), min(base.shape[1], x.stop + 1))
        component = labels[ys, xs] == ident
        area = int(component.sum())
        ring = ndi.binary_dilation(component, structure=structure) & ~component
        a, b = base[ys, xs], auxiliary[ys, xs]
        enclosure = float(np.mean(a[ring] >= 192)) if ring.any() else 0.0
        gain = a.astype(np.int16) - b.astype(np.int16)
        selected = area >= 9 and area <= base.size * .05 and enclosure >= .9 and bool(np.any(gain[component] >= 64))
        row = {'id': ident, 'box': [x.start, y.start, x.stop, y.stop], 'area': area,
               'enclosure': enclosure, 'selected': selected, 'changed_pixels': 0}
        if selected:
            weight = np.minimum(ndi.distance_transform_edt(component) / width, 1.0)
            mixed = np.rint(a.astype(np.float64) * (1 - weight) + np.minimum(a, b) * weight).astype(np.uint8)
            row['changed_pixels'] = int(np.count_nonzero((mixed != a) & component))
            out[ys, xs][component] = mixed[component]
        evidence['components'].append(row)
    evidence['changed_pixels'] = int(np.count_nonzero(out != base))
    return out, evidence
