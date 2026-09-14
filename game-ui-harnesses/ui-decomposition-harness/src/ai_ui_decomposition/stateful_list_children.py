"""Bounded direct Image/Text List children; no consumer extension or inferred copy."""
from .common import require
from .stateful_static_children import button_image_children


def intersection(a,b):
    if a is None:return b
    x=max(a[0],b[0]);y=max(a[1],b[1])
    return [x,y,max(0,min(a[0]+a[2],b[0]+b[2])-x),max(0,min(a[1]+a[3],b[1]+b[3])-y)]


def list_children(node,resources,origin,clip=None):
    if not node.get('children'):return []
    require(node['props']['style']['opacity']==1,'STATE_LIST_CHILD_OPACITY')
    clip=intersection(clip,[*origin,node['layout']['width'],node['layout']['height']])
    result=[]
    for child in node['children']:
        kind=child['type'];p=child['props'];r=child['layout']
        require(kind in {'Image','Text'} and not child.get('children'),'STATE_LIST_CHILD_TYPE:'+child['id'])
        require(p.get('drawBackground') is False and p['style']['opacity']==1,'STATE_LIST_CHILD_STYLE:'+child['id'])
        require(r['x']>=0 and r['y']>=0 and r['x']+r['width']<=node['layout']['width'] and
                r['y']+r['height']<=node['layout']['height'],'STATE_LIST_CHILD_BOUNDS:'+child['id'])
        rect=[origin[0]+r['x'],origin[1]+r['y'],r['width'],r['height']]
        require(not any(intersection(rect,a['rect'])[2]*intersection(rect,a['rect'])[3]>0 for a in result),
                'STATE_LIST_CHILD_OVERLAP:'+child['id'])
        record=dict(nodeId=child['id'],parentId=node['id'],kind=kind,rect=rect,clip=clip,
                    visibleRect=intersection(rect,clip),localLayout=dict(r))
        if kind=='Image':
            wrapper={'id':node['id'],'props':node['props'],'children':[child]}
            verified=button_image_children(wrapper,resources,origin,clip)[0]
            record.update(image=verified['image'],sha256=verified['sha256'],canvas=verified['canvas'])
        else:
            require('appearance' not in p and not p.get('fontSource') and p['wrap'] in {'word','none'} and
                    p['overflow'] in {'clip','ellipsis','error'},'STATE_LIST_CHILD_TEXT_PROFILE:'+child['id'])
            record.update(text=p['text'],fontFamily=p['style']['fontFamily'],fontSize=p['style']['fontSize'],
                          color=p['style']['textColor'],overflow=p['overflow'],wrap=p['wrap'],lineHeight=p['lineHeight'])
        result.append(record)
    return result
