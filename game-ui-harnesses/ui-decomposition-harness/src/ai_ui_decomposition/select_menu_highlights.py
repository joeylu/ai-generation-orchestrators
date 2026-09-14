"""Mirror the consumer's select-menu-highlights-v1; never infer a palette."""
import copy
import math
import re
from .common import require


def _object(value, keys, suffix):
    require(isinstance(value, dict) and set(value) == set(keys), 'SELECT_MENU_HIGHLIGHTS_' + suffix)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_menu_highlights(state, option_count, popup_size=None, *, runtime=False):
    if 'menuHighlights' not in state:
        return None
    value = state['menuHighlights']
    _object(value, ('version','coordinateSpace','selected','hover'), 'FIELDS')
    require(value['version'] == '1.0', 'SELECT_MENU_HIGHLIGHTS_VERSION')
    require(value['coordinateSpace'] == 'popup-row-local', 'SELECT_MENU_HIGHLIGHTS_COORDINATE_SPACE')
    safe = state.get('popupContentLayout')
    _object(safe, ('x','y','width','height') if runtime else ('coordinateSpace','x','y','width','height'), 'POPUP_CONTENT_REQUIRED')
    require(runtime or safe['coordinateSpace'] == 'target-popup-local', 'SELECT_MENU_HIGHLIGHTS_COORDINATE_SPACE')
    require(all(_number(safe[k]) for k in ('x','y','width','height')) and safe['x'] >= 0 and safe['y'] >= 0 and safe['width'] > 0 and safe['height'] > 0, 'SELECT_MENU_HIGHLIGHTS_POPUP_GEOMETRY')
    require(type(option_count) is int and option_count > 0, 'SELECT_MENU_HIGHLIGHTS_OPTIONS')
    if popup_size is not None:
        require(safe['x'] + safe['width'] <= popup_size[0] and safe['y'] + safe['height'] <= popup_size[1], 'SELECT_MENU_HIGHLIGHTS_POPUP_GEOMETRY')
    for key in ('selected','hover'):
        part = value[key]
        _object(part, ('color','alpha','insets','cornerRadius'), 'STATE_FIELDS')
        require(isinstance(part['color'], str) and re.fullmatch(r'#[0-9a-fA-F]{6}', part['color']), 'SELECT_MENU_HIGHLIGHTS_COLOR')
        require(_number(part['alpha']) and 0 <= part['alpha'] <= 1, 'SELECT_MENU_HIGHLIGHTS_ALPHA')
        _object(part['insets'], ('top','right','bottom','left'), 'INSETS_FIELDS')
        inset = part['insets']; radius = part['cornerRadius']
        require(all(_number(v) and v >= 0 for v in inset.values()), 'SELECT_MENU_HIGHLIGHTS_INSET')
        require(_number(radius) and radius >= 0, 'SELECT_MENU_HIGHLIGHTS_RADIUS')
        width = safe['width'] - inset['left'] - inset['right']
        height = safe['height'] / option_count - inset['top'] - inset['bottom']
        require(width > 0 and height > 0, 'SELECT_MENU_HIGHLIGHTS_ROW_GEOMETRY')
        require(radius <= min(width,height)/2, 'SELECT_MENU_HIGHLIGHTS_RADIUS_GEOMETRY')
    return value


def scale_menu_highlights(value, scale):
    result = copy.deepcopy(value)
    for key in ('selected','hover'):
        result[key]['insets'] = {k:v*scale for k,v in value[key]['insets'].items()}
        result[key]['cornerRadius'] *= scale
    return result


def require_runtime_menu_highlights(state, appearance, option_count, registration_scale):
    authored = validate_menu_highlights(state, option_count)
    actual = validate_menu_highlights(appearance, option_count, [appearance['popupCanvas']['width'],appearance['popupCanvas']['height']], runtime=True)
    require((authored is None) == (actual is None), 'STATE_SELECT_MENU_HIGHLIGHTS_MISMATCH')
    if authored is not None:
        expected = scale_menu_highlights(authored, 1/registration_scale)
        require(expected == actual, 'STATE_SELECT_MENU_HIGHLIGHTS_MISMATCH')
    return actual
