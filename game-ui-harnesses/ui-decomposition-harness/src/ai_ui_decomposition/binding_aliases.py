"""Materialize one explicitly shared Tabs glyph as unique consumer layer IDs."""
import copy
from .common import require,digest,sha256


def materialize(catalog, appearance, paths):
    catalog,appearance,paths=copy.deepcopy(catalog),copy.deepcopy(appearance),dict(paths)
    layers={r['layerId']:r for r in catalog['parts']};seen={};aliases=[]
    for binding in appearance['bindings']:
        for part in binding['parts']:
            layer=part['layerId']
            if layer not in seen:
                seen[layer]=(binding,part);continue
            prior_binding,prior=seen[layer]
            require(binding is prior_binding and binding['componentType']=='Tabs' and
                    prior.get('tabId')==part.get('tabId') and
                    {prior['role'],part['role']}=={'icon','active-icon'},'DUPLICATE_LAYER_UNSUPPORTED')
            key='glyph-alias-'+digest(dict(layer=layer,owner=binding['componentId'],part=part))[:24]
            require(key not in layers,'BINDING_ALIAS_COLLISION')
            row=copy.deepcopy(layers[layer]);row['layerId']=key
            catalog['parts'].append(row);layers[key]=row;paths[key]=paths[layer];part['layerId']=key
            aliases.append(dict(layerId=key,sourceLayerId=layer,sourceSha256=sha256(paths[layer]),
                                componentId=binding['componentId'],tabId=part['tabId'],role=part['role'],pixelIdentity=True))
    return catalog,appearance,paths,aliases
