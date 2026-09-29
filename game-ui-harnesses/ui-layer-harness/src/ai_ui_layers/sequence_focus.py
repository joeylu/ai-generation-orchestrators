"""Bounded continuous source context for aligned small planned materials."""
import math
from statistics import median
from PIL import Image, ImageDraw, ImageOps
from .evaluate import pixel_box, save, digest
from .review_image import fit_resampling


def _groups(boxes):
    groups=[]
    for axis in (0,1):
        cross=1-axis
        parents=list(range(len(boxes)))
        def root(index):
            while parents[index]!=index:
                parents[index]=parents[parents[index]];index=parents[index]
            return index
        for i,(_,a) in enumerate(boxes):
            for j in range(i):
                b=boxes[j][1]
                cross_gap=abs(a[cross]+a[cross+2]-b[cross]-b[cross+2])/2
                along_gap=abs(a[axis]+a[axis+2]-b[axis]-b[axis+2])/2
                if (cross_gap<=.35*min(a[cross+2]-a[cross],b[cross+2]-b[cross]) and
                        along_gap>=.5*min(a[axis+2]-a[axis],b[axis+2]-b[axis])):
                    parents[root(i)]=root(j)
        components={}
        for i,row in enumerate(boxes):components.setdefault(root(i),[]).append(row)
        for members in components.values():
            if len(members)<3:continue
            members.sort(key=lambda row:((row[1][axis]+row[1][axis+2])/2,row[0]))
            spacing=median(box[axis+2]-box[axis] for _,box in members)/2
            positions=[]
            for _,box in members:
                center=(box[axis]+box[axis+2])/2
                if not positions or center-positions[-1]>=spacing:positions.append(center)
            if len(positions)<3:continue
            groups.append((axis,members))
    return sorted(groups,key=lambda row:(-len(row[1]),
        max(box[3-row[0]] for _,box in row[1])-min(box[1-row[0]] for _,box in row[1]),
        row[0],tuple(mid for mid,_ in row[1])))


def make_sequence_focus(reference,plan,output,limit=2):
    """Show source gaps and ends; alignment is an observation hint, not ownership."""
    if not 1<=limit<=2:raise ValueError('SEQUENCE_FOCUS_LIMIT')
    with Image.open(reference) as image:source=image.convert('RGB')
    width,height=source.size;boxes=[]
    for material in plan['materials']:
        if material['role']!='foreground':continue
        box=pixel_box(material['bboxNorm'],width,height)
        sizes=(box[2]-box[0],box[3]-box[1]);area=sizes[0]*sizes[1]
        if 0<area<=width*height*.025 and min(sizes)>=8 and max(sizes)/min(sizes)<=4:
            boxes.append((material['id'],box))
    boxes.sort(key=lambda row:row[0])
    selected=_groups(boxes)[:limit]
    if not selected:return None
    pages=[]
    for index,(axis,members) in enumerate(selected,1):
        cross=1-axis;length=source.size[axis]
        margin=max(16,round(median(box[cross+2]-box[cross] for _,box in members)))
        low=max(0,min(box[cross] for _,box in members)-margin)
        high=min(source.size[cross],max(box[cross+2] for _,box in members)+margin)
        overlap=max(16,min(64,round(median(box[axis+2]-box[axis] for _,box in members))))
        span=min(length,max(256,math.ceil(length/6)+overlap));starts=[0]
        while starts[-1]+span<length:
            starts.append(min(starts[-1]+span-overlap,length-span))
        cell_w,cell_h=384,576;columns=min(3,len(starts))
        board=Image.new('RGB',(columns*cell_w,math.ceil(len(starts)/columns)*cell_h),(31,38,47))
        draw=ImageDraw.Draw(board);segments=[]
        for ordinal,start in enumerate(starts):
            box=[start,low,start+span,high] if axis==0 else [low,start,high,start+span]
            crop=source.crop(box)
            detail=ImageOps.contain(crop,(cell_w-16,cell_h-48),
                                   fit_resampling(crop.size,(cell_w-16,cell_h-48)))
            x=(ordinal%columns)*cell_w+(cell_w-detail.width)//2
            y=(ordinal//columns)*cell_h+40+(cell_h-48-detail.height)//2
            board.paste(detail,(x,y))
            draw.text(((ordinal%columns)*cell_w+8,(ordinal//columns)*cell_h+8),
                      'SOURCE '+str(box),fill=(245,245,245))
            segments.append(dict(sourceBox=box,displayBox=[x,y,x+detail.width,y+detail.height]))
        filename=f'coverage-sequence-source-{index:02d}.png';path=output/filename;board.save(path)
        corridor=[0,low,width,high] if axis==0 else [low,0,high,height]
        pages.append(dict(file=filename,imageSha256=digest(path),
            axis='horizontal' if axis==0 else 'vertical',sourceCorridor=corridor,
            candidateMaterialIds=[mid for mid,_ in members],segments=segments))
    metadata=dict(kind='ui_m2_sequence_source_focus_v1',referenceSha256=digest(reference),pages=pages,
        display='Clean continuous original-source corridors, split into overlapping coordinate-labelled segments. No plan IDs or boundaries are drawn. Gaps and source-axis ends are retained; alignment does not establish instance count or ownership.',
        diagnosticOnly=True)
    save(output/'coverage-sequence-source.json',metadata)
    return metadata
