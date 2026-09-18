"""Compile declared layer ownership into generation instructions; no image inference."""
from .common import digest

MARKER = 'native-material-ownership-v1:'
SURFACES = {'background', 'tab', 'active-tab', 'row', 'selected-row', 'popup',
            'track', 'box', 'fill', 'overlay', 'backdrop', 'viewport',
            'scrollbar-track', 'scrollbar-thumb'}


def compile_ownership(request, materials):
    roles = {p['layerId']: p['role'] for b in request['appearance']['bindings']
             for p in b['parts']}
    def overlap(a,b):
        return min(a[0]+a[2],b[0]+b[2])>max(a[0],b[0]) and min(a[1]+a[3],b[1]+b[3])>max(a[1],b[1])
    rows=[]
    for key,m in materials.items():
        role=roles.get(key,'background' if key=='background' else 'unknown')
        surface=role in SURFACES
        excluded=[]
        surrounding=[]
        if surface:
            for other,n in materials.items():
                if other==key or not overlap(m['rect'],n['rect']):continue
                # Alternative surface states are not contents of each other.
                other_role=roles.get(other)
                alternatives=(role==other_role or {role,other_role}<={'tab','active-tab'}
                              or {role,other_role}<={'row','selected-row'})
                if n['componentId']==m['componentId'] and alternatives:continue
                # A surrounding panel/background owns its own decoration.
                if (roles.get(other) in SURFACES and n['componentId']!=m['componentId']
                    and n['rect'][0]<=m['rect'][0] and n['rect'][1]<=m['rect'][1]
                    and n['rect'][0]+n['rect'][2]>=m['rect'][0]+m['rect'][2]
                    and n['rect'][1]+n['rect'][3]>=m['rect'][1]+m['rect'][3]):
                    surrounding.append(other)
                    continue
                excluded.append(other)
        instruction=(
            'Render only this surface and its owned border/ornaments. No ordinary text or numbers. '
            'Do not bake separately bound icons, marks, arrows, images or child controls into this surface. '
            'Preserve a state symbol only when this layer description explicitly assigns it to this surface; '
            'never preserve a symbol assigned to another listed layer.'
            if surface else
            'Render only the symbol or image assigned to this layer, with its own internal detail. '
            'If its description explicitly assigns a static tile or backplate to this image, preserve that owned surface with the image. '
            'Do not include its enclosing control, neighboring parts, text labels or copied scene background.')
        if excluded:
            instruction+=' Excluded separately rendered layers: '+', '.join(sorted(excluded))+'.'
        if surrounding:
            instruction+=' Surrounding surfaces owned elsewhere: '+', '.join(sorted(surrounding))+'. Never copy their outer frame, header, crest, crown or ornaments into this child surface. A viewport is not evidence of an independent decorated panel.'
        rows.append(dict(layerId=key,componentId=m['componentId'],role=role,
                         surface=surface,excludedLayerIds=sorted(excluded),
                         surroundingLayerIds=sorted(surrounding),instruction=instruction))
    report=dict(kind='ui_material_ownership_v1',version='1.0',
                appearanceDigest=digest(request['appearance']),layers=rows,
                scope='Declared ownership to prompt; not recognition of baked image content.',
                human_visual_acceptance=False)
    report['digest']=digest(report)
    return report
