"""Consumer scrollbar-insets-v1, in registered target-component units."""
import math
from .common import require


def validate_insets(value, track_height=None, thumb_height=None):
    require(isinstance(value, dict) and set(value) == {'version', 'top', 'bottom'}
            and value['version'] == '1.0', 'SCROLLBAR_INSETS_VERSION_OR_FIELDS')
    require(all(type(value[k]) in (int, float) and math.isfinite(value[k])
                and value[k] >= 0 for k in ('top', 'bottom')), 'SCROLLBAR_INSETS_DISTANCE')
    if track_height is not None:
        usable = track_height - value['top'] - value['bottom']
        require(usable > 0 and usable >= thumb_height, 'SCROLLBAR_INSETS_USABLE_TRACK')
    return value
