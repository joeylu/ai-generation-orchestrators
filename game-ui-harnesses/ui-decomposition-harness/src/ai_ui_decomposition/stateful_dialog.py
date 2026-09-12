"""Dialog acceptance metadata derived only from the consumed public contract."""
from .common import require


DIALOG_ROLES = {'background', 'header', 'body', 'overlay'}
DIALOG_STATES = ['open', 'closed', 'reopened']


def dialog_state(node, name, canvas, positioned, part):
    """Use draw order (body before header), preserving hidden-state resources."""
    require(name in DIALOG_STATES, 'STATE_MISSING:DIALOG')
    p = node['props']; a = p['appearance']; visible = name != 'closed'
    parts = []
    if 'overlayImage' in a:
        require(p['modal'] is True, 'STATE_DIALOG_OVERLAY_INVALID')
        require(a.get('overlayCanvas') == canvas, 'STATE_DIALOG_OVERLAY_INVALID')
        parts.append(part('overlay', 'overlay', a['overlayImage'],
                          [0, 0, canvas['width'], canvas['height']], visible))
    for role in ('background', 'body', 'header'):
        if role in a: parts.append(positioned(role, role, a[role], visible))
    children = []
    def walk(n):
        for child in n.get('children', []):
            children.append(child['id']); walk(child)
    walk(node)
    return {'parts': parts, 'value': visible, 'action': 'dialog',
            'dialog': {'modal': p['modal'], 'children': children,
                       'overlay': 'raster' if 'overlayImage' in a else 'runtime-default',
                       'backdrop': p.get('backdrop', {'color':'#10233F','opacity':0.28}),
                       'businessActions': 'not-bound-by-public-contract'}}


def dialog_ancestors(root):
    """Visibility preparation cannot assume initially open parents."""
    result = {}
    def walk(node, parents):
        result[node['id']] = list(parents)
        nested = parents + [node['id']] if node['type'] == 'Dialog' else parents
        for child in node.get('children', []): walk(child, nested)
    walk(root, [])
    return result
