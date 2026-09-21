"""Optional offline vertical registration; only explicit monotonic anchors, no inference."""
from PIL import Image


def fit_sections(image, source_y, target_y, target_height=None):
    target_height=image.height if target_height is None else target_height
    if type(target_height)!=int or target_height<1:raise ValueError('TARGET_HEIGHT')
    if len(source_y)!=len(target_y) or len(source_y)<2:raise ValueError('ANCHOR_COUNT')
    for values,extent in ((source_y,image.height),(target_y,target_height)):
        if any(type(v)!=int for v in values) or values[0]!=0 or values[-1]!=extent:raise ValueError('ANCHOR_EXTENT')
        if any(a>=b for a,b in zip(values,values[1:])):raise ValueError('ANCHOR_ORDER')
    out=Image.new('RGBA',(image.width,target_height))
    for a,b,c,d in zip(source_y,source_y[1:],target_y,target_y[1:]):
        band=image.convert('RGBA').crop((0,a,image.width,b))
        if b-a!=d-c:band=band.resize((image.width,d-c),Image.Resampling.LANCZOS)
        out.paste(band,(0,c))
    return out
