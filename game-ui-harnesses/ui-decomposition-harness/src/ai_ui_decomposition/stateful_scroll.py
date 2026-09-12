"""Vertical ScrollView expectations from the current public component contract.

This computes acceptance expectations only; it never rewrites texture geometry
or guesses additional content to fit a short thumb image.
"""
import math
from .common import require
from .scrollbar_insets import validate_insets


def scroll_geometry(node, amount):
    p=node['props'];a=p['appearance'];layout=node['layout']
    w,h=layout['width'],layout['height'];cw,ch=p.get('contentWidth'),p.get('contentHeight')
    require(all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in (w,h,cw,ch)), 'STATE_SCROLL_SEMANTICS_MISSING')
    require(cw<=w and p.get('scrollX',0)==0,'STATE_CAPABILITY_MISSING:HORIZONTAL_SCROLL')
    require(a['sourceCanvas']=={'width':w,'height':h},'STATE_GEOMETRY_MISMATCH')
    track=a['scrollbarTrack']['layout'];thumb=a['scrollbarThumbCanvas'];positions=a['scrollbarThumbPositions']
    require(all(type(v) in (int,float) and math.isfinite(v) for r in (track,thumb,positions['min'],positions['max']) for v in r.values()),'STATE_SCROLL_GEOMETRY_INVALID')
    require(track['width']>0 and track['height']>0 and thumb['width']>0 and thumb['height']>0,'STATE_SCROLL_GEOMETRY_INVALID')
    # Current runtime expands short texture templates, while preserving a larger
    # explicit authored thumb. Keep this rule observable in the receipt.
    proportional=track['height']*min(1,h/ch)
    height=min(track['height'],max(thumb['height'],proportional))
    expanded=height>thumb['height']+.01
    travel=max(0,track['height']-height) if expanded else positions['max']['y']-positions['min']['y']
    require(travel>=0,'STATE_SCROLL_GEOMETRY_INVALID')
    max_scroll=max(0,ch-h);fraction=amount if max_scroll else 0
    x=positions['min']['x']+(positions['max']['x']-positions['min']['x'])*fraction
    y=(track['y'] if expanded else positions['min']['y'])+travel*fraction
    if 'scrollbarInsets' in a:
        insets=validate_insets(a['scrollbarInsets'],track['height'],thumb['height'])
        usable=track['height']-insets['top']-insets['bottom']
        height=min(usable,max(thumb['height'],usable*min(1,h/ch)))
        travel=max(0,usable-height)
        x=positions['min']['x']
        y=track['y']+insets['top']+travel*fraction
    require(track['x']<=x and x+thumb['width']<=track['x']+track['width']+.01 and
            track['y']<=y and y+height<=track['y']+track['height']+.01,'STATE_SCROLL_GEOMETRY_INVALID')
    return {'thumb':[x,y,thumb['width'],height], 'scrollY':max_scroll*fraction,
            'travelY':travel,'maxScrollY':max_scroll,'contentHeight':ch,'viewportHeight':h,
            'contentWidth':cw,'viewport':a['viewport']['layout'],'track':track,
            'thumbPositions':positions,'sourceThumbCanvas':thumb,
            'sizingRule':('scrollbar-insets-v1:max(source-height,usable-height*viewport/content),clamped-to-usable-track' if 'scrollbarInsets' in a else 'current-runtime:max(source-height,track-height*viewport/content),clamped-to-track'),
            **({'scrollbarInsets':a['scrollbarInsets']} if 'scrollbarInsets' in a else {})}
