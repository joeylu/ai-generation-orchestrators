"""Bounded source/overlay close-ups for decoration edges and repeated cards."""
import colorsys
from PIL import Image, ImageDraw, ImageOps
from .evaluate import pixel_box, save, digest
from .card_geometry import repeated_card_height_outlier, repeated_card_alignment_group


def _window(center, span, limit):
    span=min(span,limit)
    start=max(0,min(limit-span,center-span//2))
    return start,start+span


def make_small_material_focus(reference, plan, output, limit=12):
    """Enlarge small planned artwork for M2 evidence without changing the plan."""
    with Image.open(reference) as image:
        source=image.convert('RGB');width,height=source.size
    selected=[]
    for material in plan['materials']:
        if material['role']!='foreground':continue
        box=pixel_box(material['bboxNorm'],width,height)
        area=(box[2]-box[0])*(box[3]-box[1])
        if 0<area<=width*height*.025 and min(box[2]-box[0],box[3]-box[1])>=16:
            selected.append((material['id'],box))
    selected=selected[:limit]
    if not selected:return None
    cell_w,cell_h=288,240;columns=min(3,len(selected));rows=(len(selected)+columns-1)//columns
    board=Image.new('RGB',(columns*cell_w,rows*cell_h),(31,38,47));draw=ImageDraw.Draw(board)
    for i,(mid,box) in enumerate(selected):
        x=(i%columns)*cell_w;y=(i//columns)*cell_h
        draw.text((x+8,y+6),mid,fill=(245,245,245))
        crop=source.crop(tuple(box))
        enlarged=ImageOps.contain(crop,(cell_w-16,cell_h-36),Image.Resampling.NEAREST)
        board.paste(enlarged,(x+(cell_w-enlarged.width)//2,y+28+(cell_h-36-enlarged.height)//2))
    image_path=output/'coverage-small-materials.png';board.save(image_path)
    metadata=dict(kind='ui_m2_small_material_focus_v1',file=image_path.name,
                  imageSha256=digest(image_path),items=[dict(materialId=mid,sourceBox=box) for mid,box in selected],
                  display='Original reference crops enlarged uniformly with nearest-neighbor; labels and dark margins are diagnostic only.')
    # A single enlarged crop preserves tiny multicolor markings that can be
    # lost when the contact sheet is downsampled by a vision transport.
    candidates=[]
    for mid,box in selected:
        crop=source.crop(tuple(box));bins=[0]*12
        pixels=crop.tobytes()
        for red,green,blue in zip(pixels[0::3],pixels[1::3],pixels[2::3]):
            hue,saturation,value=colorsys.rgb_to_hsv(red/255,green/255,blue/255)
            if saturation>.4 and value>.25:bins[int(hue*12)%12]+=1
        threshold=max(8,crop.width*crop.height//1000)
        diversity=sum(count>=threshold for count in bins)
        candidates.append((diversity,mid,box))
    diversity,mid,box=max(candidates)
    if diversity>=4:
        detail=ImageOps.contain(source.crop(tuple(box)),(512,512),Image.Resampling.LANCZOS)
        detail_path=output/'coverage-color-detail.png';detail.save(detail_path)
        metadata['detail']=dict(file=detail_path.name,materialId=mid,sourceBox=box,
                                imageSha256=digest(detail_path),
                                display='Same original crop enlarged with Lanczos; no visual content added.')
    save(output/'coverage-small-materials.json',metadata)
    return metadata


def make_focus(reference, overlay, plan, output, limit=3):
    """Attach bounded edge evidence and one comparison for aligned cards."""
    with Image.open(reference) as source, Image.open(overlay) as marked:
        source=source.convert('RGB');marked=marked.convert('RGB')
        if marked.size!=source.size:raise ValueError('FOCUS_IMAGE_SIZE_MISMATCH')
        width,height=source.size
        owners={m['id']:m for m in plan['materials'] if m['role']=='foreground'}
        edge_order={'top':0,'bottom':1,'left':2,'right':3}
        risks=[]
        for obj in plan['objects']:
            owner=owners.get(obj['materialId'])
            if not owner or obj['kind']!='decoration' or obj['bboxNorm'] is None:continue
            ml,mt,mr,mb=pixel_box(owner['bboxNorm'],width,height)
            owner_area=(mr-ml)*(mb-mt)
            if owner_area<width*height*.04:continue
            ol,ot,orr,ob=pixel_box(obj['bboxNorm'],width,height)
            # An almost full-owner annotation cannot localize an edge detail.
            if (orr-ol)*(ob-ot)>=owner_area*.75:continue
            object_area=(orr-ol)*(ob-ot)
            for edge,gap in [('top',ot-mt),('bottom',mb-ob),('left',ol-ml),('right',mr-orr)]:
                if 0<=gap<=12:risks.append((gap,-object_area,edge_order[edge],owner['id'],edge,obj['id'],(ml,mt,mr,mb),(ol,ot,orr,ob)))
        risks.sort()
        # A corner ornament can be clipped on more than one edge. Keep up to
        # two observations per object; deduping by object hid the board's leaf.
        selected=[];counts={}
        for risk in risks:
            key=(risk[3],risk[5])
            if counts.get(key,0)>=2:continue
            selected.append(risk);counts[key]=counts.get(key,0)+1
            if len(selected)==limit:break
        evidence=[]
        for index,(gap,_area,_edge_order,mid,edge,oid,material,object_box) in enumerate(selected,1):
            ml,mt,mr,mb=material;ol,ot,orr,ob=object_box
            if edge in ('top','bottom'):
                x0,x1=_window((ol+orr)//2,max(192,min(512,orr-ol+128)),width)
                y0,y1=_window((mt if edge=='top' else mb)+(-16 if edge=='top' else 16),160,height)
                edge_pixel=mt if edge=='top' else mb
            else:
                x0,x1=_window((ml if edge=='left' else mr)+(-16 if edge=='left' else 16),160,width)
                y0,y1=_window((ot+ob)//2,max(192,min(512,ob-ot+128)),height)
                edge_pixel=ml if edge=='left' else mr
            box=(x0,y0,x1,y1);clean=source.crop(box);labels=marked.crop(box)
            scaled=(2*clean.width,2*clean.height)
            comparison=Image.new('RGB',(scaled[0]*2,scaled[1]))
            comparison.paste(clean.resize(scaled,Image.Resampling.NEAREST),(0,0))
            comparison.paste(labels.resize(scaled,Image.Resampling.NEAREST),(scaled[0],0))
            name=f'focus-{index:02d}.png';comparison.save(output/name)
            evidence.append({'file':name,'materialId':mid,'objectId':oid,'edge':edge,
                             'distancePixels':gap,'sourceBox':[x0,y0,x1,y1],
                             'materialEdgePixel':edge_pixel,'scale':2})
        if len(evidence)<limit:
            flagged=repeated_card_height_outlier(plan)
            normalized=flagged[0] if flagged else repeated_card_alignment_group(plan)
            if normalized:
                group=[(mid,pixel_box(box,width,height)) for mid,box in normalized]
                typical=sorted(box[3]-box[1] for _,box in group)[len(group)//2]
                x0=max(0,min(box[0] for _,box in group)-16)
                x1=min(width,max(box[2] for _,box in group)+16)
                rows=[];total_height=0
                vertical_margin=max(16,min(48,round(typical*.35)))
                for mid,(left,top,right,bottom) in group:
                    y0=max(0,top-vertical_margin);y1=min(height,bottom+vertical_margin)
                    rows.append((mid,(x0,y0,x1,y1),(left,top,right,bottom)))
                    total_height+=2*(y1-y0)+4
                pane_width=2*(x1-x0)
                comparison=Image.new('RGB',(pane_width*2,total_height),(34,40,48))
                offset=0
                for _,bounds,_ in rows:
                    clean=source.crop(bounds).resize((pane_width,2*(bounds[3]-bounds[1])),Image.Resampling.NEAREST)
                    labels=marked.crop(bounds).resize(clean.size,Image.Resampling.NEAREST)
                    comparison.paste(clean,(0,offset));comparison.paste(labels,(pane_width,offset))
                    offset+=clean.height+4
                name=f'focus-{len(evidence)+1:02}.png';comparison.save(output/name)
                item={'file':name,'kind':'repeated-card-height-outlier' if flagged else 'repeated-card-alignment-comparison',
                      'materialIds':[mid for mid,_,_ in rows], 'medianHeightPixels':typical,
                      'materialBoxes':[list(box) for _,_,box in rows],
                      'sourceBoxes':[list(bounds) for _,bounds,_ in rows],
                      'display':'rows top-to-bottom; each row clean source left, labeled overlay right; scale 2',
                      'scale':2}
                if flagged:
                    outlier_id=flagged[1]
                    item.update(suspectedOutlierId=outlier_id,
                                peerHeightEdgeAlternativesPixels={
                                    'topIfBottomCorrect':next(box[3] for mid,box in group if mid==outlier_id)-typical,
                                    'bottomIfTopCorrect':next(box[1] for mid,box in group if mid==outlier_id)+typical})
                evidence.append(item)
        return evidence
