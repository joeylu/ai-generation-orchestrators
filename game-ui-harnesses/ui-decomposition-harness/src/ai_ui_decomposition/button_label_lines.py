"""Mirror the consumer button-label-lines-v1 contract; no content inference."""
import math
from .common import require

def validate_label_lines(value,label=None,size=None):
    require(isinstance(value,dict) and set(value)=={'version','coordinateSpace','lines'} and value['version']=='1.0' and value['coordinateSpace']=='target-component-local','BUTTON_LABEL_LINES_VERSION')
    lines=value['lines'];require(isinstance(lines,list) and 1<=len(lines)<=8,'BUTTON_LABEL_LINES_COUNT')
    rects=[]
    for line in lines:
        require(isinstance(line,dict) and set(line)=={'text','fontSize','fontWeight','align','layout'} and isinstance(line['text'],str) and line['text'].strip() and '\n' not in line['text'] and '\r' not in line['text'],'BUTTON_LABEL_LINES_FIELDS')
        require(type(line['fontSize']) in (int,float) and math.isfinite(line['fontSize']) and line['fontSize']>0 and line['fontWeight'] in ('normal','bold') and line['align'] in ('left','center','right'),'BUTTON_LABEL_LINES_STYLE')
        r=line['layout'];require(isinstance(r,dict) and set(r)=={'x','y','width','height'} and all(type(v) in (int,float) and math.isfinite(v) for v in r.values()),'BUTTON_LABEL_LINES_BOUNDS')
        require(r['x']>=0 and r['y']>=0 and r['width']>0 and r['height']>=line['fontSize']*1.25 and (size is None or (r['x']+r['width']<=size[0] and r['y']+r['height']<=size[1])),'BUTTON_LABEL_LINES_BOUNDS')
        require(not any(r['x']<q['x']+q['width'] and r['x']+r['width']>q['x'] and r['y']<q['y']+q['height'] and r['y']+r['height']>q['y'] for q in rects),'BUTTON_LABEL_LINES_OVERLAP');rects.append(r)
    require(label is None or '\n'.join(l['text'] for l in lines)==label,'BUTTON_LABEL_LINES_TEXT_MISMATCH')
    return lines
