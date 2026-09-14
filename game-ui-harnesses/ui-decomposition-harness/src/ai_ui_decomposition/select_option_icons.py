"""Producer checks for the consumer's select-option-icons-v1 contract."""
import math

from .common import require


def _object(value, keys, code):
    require(isinstance(value, dict) and set(value) == set(keys), code)


def _rect(value, width, height):
    code = 'SELECT_OPTION_ICONS_LAYOUT_INVALID'
    _object(value, ('x', 'y', 'width', 'height'), code)
    require(all(type(v) in (int, float) and math.isfinite(v) for v in value.values()), code)
    require(value['x'] >= 0 and value['y'] >= 0 and value['width'] > 0 and value['height'] > 0, code)
    require(value['x'] + value['width'] <= width + 1e-6 and
            value['y'] + value['height'] <= height + 1e-6, code)


def validate_option_icons(state, option_ids, layers=None, popup_size=None, *, reference='layerId'):
    """Return explicit items, or None for a legacy declaration. No inferred icons."""
    if 'optionIcons' not in state:
        return None
    value = state['optionIcons']
    _object(value, ('version', 'coordinateSpace', 'items'), 'SELECT_OPTION_ICONS_INVALID')
    require(value['version'] == '1.0', 'SELECT_OPTION_ICONS_VERSION_UNSUPPORTED')
    require(value['coordinateSpace'] == 'popup-row-local', 'SELECT_OPTION_ICONS_COORDINATE_SPACE')
    safe = state.get('popupContentLayout')
    expected = ('x', 'y', 'width', 'height') if reference == 'image' else ('coordinateSpace', 'x', 'y', 'width', 'height')
    _object(safe, expected, 'SELECT_OPTION_ICONS_SAFE_AREA_REQUIRED')
    if reference == 'layerId':
        require(safe['coordinateSpace'] == 'target-popup-local', 'SELECT_OPTION_ICONS_COORDINATE_SPACE')
    rect = {k: safe[k] for k in ('x', 'y', 'width', 'height')}
    _rect(rect, *(popup_size or (float('inf'), float('inf'))))
    require(isinstance(option_ids, list) and len(option_ids) > 0 and all(isinstance(i, str) for i in option_ids) and
            len(set(option_ids)) == len(option_ids), 'SELECT_OPTION_ICONS_OPTIONS_INVALID')
    items = value['items']
    require(isinstance(items, list) and len(items) == len(option_ids), 'SELECT_OPTION_ICONS_OPTION_COVERAGE')
    seen = set()
    for item in items:
        _object(item, ('optionId', 'icon', 'labelLayout'), 'SELECT_OPTION_ICONS_ITEM_INVALID')
        ident = item['optionId']
        require(isinstance(ident, str) and ident in option_ids and ident not in seen, 'SELECT_OPTION_ICONS_OPTION_COVERAGE')
        seen.add(ident)
        label = item['labelLayout']
        _rect(label, safe['width'], safe['height'] / len(option_ids))
        icon = item['icon']
        if icon is None:
            continue
        _object(icon, (reference, 'layout'), 'SELECT_OPTION_ICONS_ICON_INVALID')
        require(isinstance(icon[reference], str) and bool(icon[reference].strip()), 'SELECT_OPTION_ICONS_REFERENCE_INVALID')
        require(layers is None or icon[reference] in layers, 'SELECT_OPTION_ICONS_UNKNOWN_LAYER')
        r = icon['layout']
        _rect(r, safe['width'], safe['height'] / len(option_ids))
        overlap = (r['x'] < label['x'] + label['width'] - 1e-6 and label['x'] < r['x'] + r['width'] - 1e-6 and
                   r['y'] < label['y'] + label['height'] - 1e-6 and label['y'] < r['y'] + r['height'] - 1e-6)
        require(not overlap, 'SELECT_OPTION_ICONS_LABEL_OVERLAP')
    return items


def contain_rect(layout, size, origin):
    """Use the whole PNG canvas including alpha padding, never an alpha bbox."""
    scale = min(layout['width'] / size[0], layout['height'] / size[1])
    width, height = size[0] * scale, size[1] * scale
    return [origin[0] + layout['x'] + (layout['width'] - width) / 2,
            origin[1] + layout['y'] + (layout['height'] - height) / 2, width, height]
