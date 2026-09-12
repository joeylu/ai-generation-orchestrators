"""Native-size Button Image children are semantic resources, not binding roles."""
import base64
import hashlib
import io
import copy
from PIL import Image
from .common import require


def select_image_overlays(root, node, resources, origin, inherited_clip=None):
    """Validate direct later Image siblings wholly inside a Select field.

    Select has no children in the public tree contract. A separate field icon is
    therefore a sibling. Only the field-local static profile is supported here;
    popup/nested/dynamic covering content is not inferred or masked.
    """
    for parent in _parents(root):
        siblings = parent.get('children', [])
        index = next((i for i, child in enumerate(siblings) if child['id'] == node['id']), None)
        if index is None:
            continue
        selected = []
        nr = node['layout']
        for sibling in siblings[index + 1:]:
            if sibling['type'] != 'Image':
                continue
            r = sibling['layout']
            x, y = r['x'] - nr['x'], r['y'] - nr['y']
            if x >= nr['width'] or y >= nr['height'] or x+r['width'] <= 0 or y+r['height'] <= 0:
                continue
            require(x >= 0 and y >= 0 and x+r['width'] <= nr['width'] and y+r['height'] <= nr['height'],
                    'STATE_STATIC_CHILD_UNSUPPORTED:PARTIAL_SELECT_OVERLAY')
            child = copy.deepcopy(sibling)
            child['layout'].update(x=x, y=y)
            selected.append(child)
        wrapper = dict(id=node['id'], props=node['props'], children=selected)
        records = button_image_children(wrapper, resources, origin, inherited_clip)
        for record in records:
            record['resourceBinding'] = 'consumed-semantic-select-field-sibling'
        return records
    return []


def _parents(node):
    yield node
    for child in node.get('children', []):
        yield from _parents(child)


def button_image_children(node, resources, origin, inherited_clip=None):
    records = []
    for child in node.get('children', []):
        # A separate adapter must own text, nesting, masks, or other controls.
        require(child['type'] == 'Image', 'STATE_STATIC_CHILD_UNSUPPORTED:' + child['id'])
        p, r = child['props'], child['layout']
        require(not child.get('children') and 'region' not in p and p.get('drawBackground') is False,
                'STATE_STATIC_CHILD_UNSUPPORTED:' + child['id'])
        require(p['style']['opacity'] == 1 and node['props']['style']['opacity'] == 1,
                'STATE_STATIC_CHILD_UNSUPPORTED:OPACITY')
        require(p.get('fit') in {'contain', 'cover', 'stretch'}, 'STATE_STATIC_CHILD_UNSUPPORTED:FIT')
        resource = resources.get(p['source'])
        require(isinstance(resource, dict), 'STATE_RESOURCE_MISMATCH')
        try:
            payload = base64.b64decode(resource['base64'], validate=True)
        except (ValueError, TypeError):
            require(False, 'STATE_RESOURCE_MISMATCH')
        require(hashlib.sha256(payload).hexdigest() == resource['sha256'], 'STATE_RESOURCE_MISMATCH')
        with Image.open(io.BytesIO(payload)) as image:
            require(image.width * image.height <= 16_777_216, 'STATE_IMAGE_LIMIT')
            image.load()
            require(image.mode == 'RGBA', 'STATE_ALPHA_INVALID:' + child['id'])
            require([image.width, image.height] == [r['width'], r['height']],
                    'STATE_GEOMETRY_MISMATCH:STATIC_CHILD')
            alpha = image.getchannel('A')
            require(alpha.getextrema()[0] == 0 and alpha.getextrema()[1] > 0,
                    'STATE_ALPHA_INVALID:' + child['id'])
            records.append(dict(slot='child-image/' + child['id'], staticChild=True,
                nodeId=child['id'], parentId=node['id'], image=p['source'],
                sha256=resource['sha256'], pixelSha256=hashlib.sha256(image.tobytes()).hexdigest(),
                alphaSha256=hashlib.sha256(alpha.tobytes()).hexdigest(),
                canvas=[image.width, image.height], coordinateSpace='target-canvas',
                rect=[origin[0]+r['x'], origin[1]+r['y'], r['width'], r['height']],
                localLayout=dict(coordinateSpace='target-component-local', **r),
                clip=inherited_clip, visible=True,
                resourceBinding='consumed-semantic-image-child'))
    return records
