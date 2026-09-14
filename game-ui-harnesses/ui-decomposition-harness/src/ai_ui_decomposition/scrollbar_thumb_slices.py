"""Consumer scrollbar-thumb-slices-v1. Source pixels never become track units."""
from typing import Literal, TypedDict
import math
from .common import require


class ScrollbarThumbSlices(TypedDict):
    version: Literal['1.0']
    coordinateSpace: Literal['thumb-source-pixels']
    top: int
    bottom: int


def validate_thumb_slices(value, height=None, has_insets=False):
    require(has_insets,'SCROLLBAR_THUMB_SLICES_INSETS_REQUIRED')
    require(isinstance(value,dict) and set(value)=={'version','coordinateSpace','top','bottom'} and
            value['version']=='1.0' and value['coordinateSpace']=='thumb-source-pixels','SCROLLBAR_THUMB_SLICES_FIELDS')
    require(all(type(value[k]) in (int,float) and math.isfinite(value[k]) and value[k]>=0 and value[k]==int(value[k]) for k in ('top','bottom')),'SCROLLBAR_THUMB_SLICES_INTEGER')
    if height is not None:
        require(type(height) in (int,float) and math.isfinite(height) and height>0 and value['top']+value['bottom']<height,'SCROLLBAR_THUMB_SLICES_MIDDLE_REQUIRED')
    return value
