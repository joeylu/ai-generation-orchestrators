"""Horizontal Slider acceptance expectations; never changes the supplied contract."""
import math
from decimal import Decimal, ROUND_HALF_UP, localcontext
from .common import require


def _consumer_precision(step):
    # ECMAScript String(number) uses fixed notation for [1e-6, 1e21), unlike
    # Python's str(1e-5). Its scientific exponents do not have leading zeros.
    return max(0, -Decimal(str(step)).normalize().as_tuple().exponent)


def _consumer_fixed(value, precision):
    # toFixed rounds the actual binary float, with exact ties away from zero.
    # Python round uses half-even; Decimal(str(value)) would lose binary tails.
    if abs(value) >= 1e21: return value
    with localcontext() as context:
        context.prec = 350
        return float(Decimal.from_float(float(value)).quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP))


def progress_geometry(node, name):
    """ProgressBar fill-mask probes include the actual reference-bound initial value."""
    p = node['props']; a = p['appearance']; maximum = p.get('max')
    require(type(maximum) in (int, float) and math.isfinite(maximum) and maximum > 0,
            'STATE_PROGRESS_SEMANTICS_INVALID')
    require(name in {'initial', 'empty', 'middle', 'full'}, 'STATE_PROGRESS_STATE_INVALID')
    value = {'initial': p['value'], 'empty': 0, 'middle': maximum / 2, 'full': maximum}[name]
    require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum,
            'STATE_PROGRESS_SEMANTICS_INVALID')
    clip = a['fillClip']; layout = node['layout']
    require(a['sourceCanvas'] == {'width': layout['width'], 'height': layout['height']}, 'STATE_GEOMETRY_MISMATCH')
    require(all(type(clip.get(k)) in (int, float) and math.isfinite(clip[k]) for k in ('x', 'y', 'width', 'height')) and
            clip['x'] >= 0 and clip['y'] >= 0 and clip['width'] > 0 and clip['height'] > 0 and
            clip['x'] + clip['width'] <= layout['width'] and clip['y'] + clip['height'] <= layout['height'],
            'STATE_PROGRESS_GEOMETRY_INVALID')
    ratio = value / maximum
    return {'value': value, 'ratio': ratio, 'max': maximum,
            'fillClip': [clip['x'], clip['y'], clip['width'] * ratio, clip['height']]}


def slider_geometry(node, name):
    p = node['props']; a = p['appearance']; layout = node['layout']
    low, high, step = p.get('min'), p.get('max'), p.get('step')
    finite = lambda v: type(v) in (int, float) and math.isfinite(v)
    require(all(finite(v) for v in (low, high, step)) and high > low and step > 0,
            'STATE_SLIDER_SEMANTICS_INVALID')
    require(name in {'min', 'middle', 'max'}, 'STATE_SLIDER_STATE_INVALID')
    require(a['sourceCanvas'] == {'width': layout['width'], 'height': layout['height']},
            'STATE_GEOMETRY_MISMATCH')
    start, end = a['thumbPositions']['min'], a['thumbPositions']['max']
    thumb, clip = a['thumbCanvas'], a['fillClip']
    require(all(finite(v) for r in (start, end, thumb) for v in r.values()),
            'STATE_SLIDER_GEOMETRY_INVALID')
    require(start['y'] == end['y'] and end['x'] > start['x'] and min(thumb.values()) > 0,
            'STATE_SLIDER_GEOMETRY_INVALID')
    for point in (start, end):
        require(point['x'] >= 0 and point['y'] >= 0 and
                point['x'] + thumb['width'] <= layout['width'] and
                point['y'] + thumb['height'] <= layout['height'], 'STATE_SLIDER_GEOMETRY_INVALID')
    require(all(finite(clip.get(k)) for k in ('x', 'y', 'width', 'height')) and
            clip['x'] >= 0 and clip['y'] >= 0 and clip['width'] > 0 and clip['height'] > 0 and
            clip['x'] + clip['width'] <= layout['width'] and
            clip['y'] + clip['height'] <= layout['height'], 'STATE_SLIDER_GEOMETRY_INVALID')
    # Match the consumer's positive quotient Math.round, including half-step ties.
    target = {'min': low, 'middle': (low + high) / 2, 'max': high}[name]
    aligned = lambda v: abs((v-low)/step-round((v-low)/step)) <= 2.220446049250313e-16*max(1,abs((v-low)/step))*8
    span = (high-low)/step
    require(math.isfinite(span), 'STATE_SLIDER_SEMANTICS_INVALID')
    last = round(span) if aligned(high) else math.floor(span)
    index = max(0,min(last,math.floor((target-low)/step+.5)))
    snapped = low+index*step
    precision = max(_consumer_precision(low),_consumer_precision(step))
    rounded = _consumer_fixed(snapped,precision) if precision<=100 else snapped
    value = rounded if low<=rounded<=high and aligned(rounded) else snapped
    if not (low<=value<=high and aligned(value)) and index==last and aligned(high): value=high
    require(low<=value<=high and aligned(value),'STATE_SLIDER_UNREPRESENTABLE')
    ratio = (value - low) / (high - low)
    x = start['x'] + (end['x'] - start['x']) * ratio
    return {'value': value, 'ratio': ratio, 'min': low, 'max': high, 'step': step,
            'thumb': [x, start['y'], thumb['width'], thumb['height']],
            'fillClip': [clip['x'], clip['y'], clip['width'] * ratio, clip['height']],
            'thumbPositions': a['thumbPositions'], 'sourceThumbCanvas': thumb}
