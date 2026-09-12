"""Producer implementation of consumer Switch stateImages 1.0."""
from .common import require

def validate_state_images(row, sizes=None):
    state=row.get('states',{}).get('switch',{})
    if 'stateImages' not in state: return None
    require(row.get('componentType')=='Switch','SWITCH_STATE_IMAGE_TYPE')
    images=state['stateImages']
    require(isinstance(images,dict) and set(images)=={'version','off','on'},'SWITCH_STATE_IMAGES_FIELDS')
    require(images['version']=='1.0','SWITCH_STATE_IMAGES_VERSION')
    bases={}
    for role in ('track','thumb'):
        found=[p.get('layerId') for p in row.get('parts',[]) if p.get('role')==role]
        require(len(found)==1 and isinstance(found[0],str),'SWITCH_BASE_PART_REQUIRED')
        bases[role]=found[0]
    for side in ('off','on'):
        pair=images[side]
        require(isinstance(pair,dict) and set(pair)=={'trackLayerId','thumbLayerId'},'SWITCH_STATE_IMAGES_PAIR')
        for role in ('track','thumb'):
            ident=pair[role+'LayerId']
            require(isinstance(ident,str) and bool(ident.strip()),'SWITCH_STATE_IMAGE_REFERENCE')
            if sizes is not None:
                require(ident in sizes and bases[role] in sizes,'SWITCH_STATE_IMAGE_UNKNOWN_LAYER')
                require(tuple(sizes[ident])==tuple(sizes[bases[role]]),'SWITCH_STATE_IMAGE_SIZE_MISMATCH')
    return images
