"""Conservative geometry-only detection of a single framed material with owned details."""


def integrated_surface(visual, material):
    if material['role'] != 'foreground': return None
    objects=[o for o in visual['objects'] if o['materialId']==material['id']]
    region=material.get('bboxNorm')
    if len(objects)<2 or not region: return None
    def contains(outer, inner):
        return outer[0]<=inner[0] and outer[1]<=inner[1] and outer[2]>=inner[2] and outer[3]>=inner[3]
    surfaces=[o for o in objects if o['kind'] in ('card','button')]
    # The v5 contract permits a null auxiliary box for the sole outer surface.
    # Its material region already supplies the complete placement bounds. Only
    # bounded decorative/icon children qualify; separate controls never do.
    if len(surfaces)==1 and surfaces[0].get('bboxNorm') is None:
        children=[o for o in objects if o is not surfaces[0]]
        if all(o['kind'] in ('icon','decoration','badge') and o.get('bboxNorm')
               and contains(region,o['bboxNorm']) for o in children):
            return surfaces[0]['id']
    if any(not o.get('bboxNorm') for o in objects): return None
    roots=[o for o in objects if o['kind'] in ('card','button')
           and all(abs(a-b)<=1e-6 for a,b in zip(o['bboxNorm'],region))
           and all(contains(o['bboxNorm'],child['bboxNorm']) for child in objects)]
    # Ambiguous duplicate outer surfaces must not silently become one frame.
    return roots[0]['id'] if len(roots)==1 else None
