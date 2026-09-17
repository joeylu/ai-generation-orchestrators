"""Explicit source observations, not inferred visual fidelity or new consumer fields."""
import math
from .common import require


def apply_observations(facts, request):
    spec=facts.get('materialObservations')
    if spec is None:
        return
    require(isinstance(spec,dict) and set(spec)=={'version','items'} and spec['version']=='1.0','SHOP_MATERIAL_OBSERVATIONS_VERSION')
    require(isinstance(spec['items'],list) and 0<len(spec['items'])<=128,'SHOP_MATERIAL_OBSERVATIONS_ITEMS')
    materials={m['layerId']:m for m in request['materials']}
    geometry={m['materialId']:m for m in request['visibleGeometryRequirements']}
    seen=set()
    for row in spec['items']:
        require(isinstance(row,dict) and {'layerId','evidence'}<=set(row)<= {'layerId','evidence','minimumOccupancy'},'SHOP_MATERIAL_OBSERVATIONS_FIELDS')
        key=row['layerId']
        require(isinstance(key,str) and key in materials and key not in seen,'SHOP_MATERIAL_OBSERVATIONS_LAYER')
        seen.add(key)
        require(isinstance(row['evidence'],str) and bool(row['evidence'].strip()),'SHOP_MATERIAL_OBSERVATIONS_EVIDENCE')
        materials[key]['description']+=' Explicit source appearance observation: '+row['evidence']
        if 'acceptanceScope' in request:
            request['acceptanceScope']['derivedTestStates'].append(dict(componentId=materials[key]['componentId'],basis='contract-derived',
                description='Delivery material requirement from reviewed source; not evidence of an unshown runtime state: '+row['evidence']))
        minimum=row.get('minimumOccupancy')
        if minimum is not None:
            require(isinstance(minimum,dict) and bool(minimum) and set(minimum)<={'width','height'} and
                    all(type(v) in (int,float) and math.isfinite(v) and 0<v<=1 for v in minimum.values()),'SHOP_MATERIAL_OBSERVATIONS_OCCUPANCY')
            check=geometry.get(key)
            if check is None:
                check=dict(materialId=key,alphaThreshold=1,minimumOccupancy={},reservedRects=[],textWorldRects=[],imageWorldRect=None)
                request['visibleGeometryRequirements'].append(check)
            for axis,value in minimum.items():
                check['minimumOccupancy'][axis]=max(check['minimumOccupancy'].get(axis,0),value)
