"""Conservative geometry-only detection of a single framed material with owned details."""


def integrated_surface(visual, material):
    if material['role'] != 'foreground': return None
    objects=[o for o in visual['objects'] if o['materialId']==material['id']]
    region=material.get('bboxNorm')
    if len(objects)<2 or not region or any(not o.get('bboxNorm') for o in objects): return None
    def contains(outer, inner):
        return outer[0]<=inner[0] and outer[1]<=inner[1] and outer[2]>=inner[2] and outer[3]>=inner[3]
    roots=[o for o in objects if o['kind'] in ('card','button')
           and all(abs(a-b)<=1e-6 for a,b in zip(o['bboxNorm'],region))
           and all(contains(o['bboxNorm'],child['bboxNorm']) for child in objects)]
    # Ambiguous duplicate outer surfaces must not silently become one frame.
    return roots[0]['id'] if len(roots)==1 else None
