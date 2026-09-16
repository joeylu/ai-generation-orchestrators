"""Check explicit reference observations against real rendered text and frame ownership.

This does not discover text by OCR or recognize arbitrary painted ornaments.
"""
import base64
import io
import math
from PIL import Image
from .common import require
from .visual_policy import walk,contains

def check_visual_observations(bundle, observations, inspection):
    require(observations.get('kind')=='ui_visual_observations_v1','VISUAL_OBSERVATIONS_KIND')
    nodes={n['id']:n for n in walk(bundle['document']['root'])}
    actual={n['id']:n for n in inspection['nodes']}
    resources={r['path']:r for r in bundle['resources']}
    issues=[];checks=[];rendered=[]
    def check(ok,code,ident,**detail):
        row=dict(componentId=ident,code=code,pass_=bool(ok),**detail);checks.append(row)
        if not ok:issues.append(row)
    required=observations.get('requiredTextGeometryIds',[])
    require(isinstance(required,list) and all(isinstance(x,str) for x in required) and len(required)==len(set(required)),'TEXT_GEOMETRY_REQUIRED_IDS')
    for ident in required:
        check(any(s['componentId']==ident and 'geometry' in s for s in observations['texts']),'TEXT_GEOMETRY_MISSING',ident)
    for spec in observations['texts']:
        ident=spec['componentId'];n=nodes.get(ident);a=actual.get(ident)
        check(n is not None and a is not None,'TEXT_OWNER_MISSING',ident)
        if not n or not a:continue
        labels=a.get('renderedTextBounds',[]);label=next((l for l in labels if l['text']==spec['text']),None)
        check(label is not None,'RUNTIME_TEXT_MISSING_OR_TRUNCATED',ident,expected=spec['text'])
        if not label:continue
        check(a.get('visible') is True,'RUNTIME_TEXT_NOT_VISIBLE',ident)
        rendered.append((ident,label['bounds']))
        check(label['fontFamily']=='Arial' and label['fontSize']>=spec['minFontSize'],'TEXT_FONT_OR_SIZE',ident,actual=label)
        r=spec['region'];tolerance=4
        envelope=dict(x=r['x']-tolerance,y=r['y']-tolerance,width=r['width']+2*tolerance,height=r['height']+2*tolerance)
        check(contains(envelope,label['bounds']),'TEXT_OUTSIDE_OBSERVED_REGION',ident,actual=label['bounds'],expected=r)
        if 'geometry' in spec:
            g=spec['geometry']
            require(isinstance(g,dict) and set(g)=={'version','referenceBounds','maxCenterOffset','widthRatio','evidence'} and g['version']=='1.0','TEXT_GEOMETRY_SCHEMA')
            require(isinstance(g['evidence'],str) and bool(g['evidence'].strip()),'TEXT_GEOMETRY_EVIDENCE')
            ref=g['referenceBounds'];offset=g['maxCenterOffset'];ratio=g['widthRatio']
            require(isinstance(ref,list) and len(ref)==4 and isinstance(offset,list) and len(offset)==2 and isinstance(ratio,list) and len(ratio)==2,'TEXT_GEOMETRY_VALUES')
            require(all(type(v) in (int,float) and math.isfinite(v) for v in ref+offset+ratio) and min(ref[2:])>0 and min(offset)>=0 and 0<ratio[0]<=ratio[1],'TEXT_GEOMETRY_VALUES')
            b=label['bounds'];delta=[abs(b['x']+b['width']/2-ref[0]-ref[2]/2),abs(b['y']+b['height']/2-ref[1]-ref[3]/2)]
            check(all(delta[i]<=offset[i] for i in range(2)),'TEXT_RENDERED_CENTER',ident,actualOffset=delta,maximum=offset)
            value=b['width']/ref[2]
            check(ratio[0]<=value<=ratio[1],'TEXT_RENDERED_WIDTH_RATIO',ident,actualRatio=value,allowed=ratio)
    for index,(ident,one) in enumerate(rendered):
        for other_id,two in rendered[index+1:]:
            width=min(one['x']+one['width'],two['x']+two['width'])-max(one['x'],two['x'])
            height=min(one['y']+one['height'],two['y']+two['height'])-max(one['y'],two['y'])
            check(width<=1 or height<=1,'OBSERVED_TEXT_OVERLAP',ident,otherComponentId=other_id)
    for spec in observations.get('scrollViews', []):
        from .stateful_scroll import scroll_geometry
        ident=spec['componentId'];n=nodes.get(ident);observed=actual.get(ident)
        check(n is not None and observed is not None and n['type']=='ScrollView','SCROLL_OWNER_MISSING',ident)
        if n is None or observed is None:continue
        check(n['layout']['height']==spec['viewportHeight'] and n['props']['contentHeight']==spec['contentHeight'],'SCROLL_DERIVED_LAYOUT',ident)
        check(n['props'].get('scrollbarVisibility')=='always','SCROLL_REFERENCE_CHROME_VISIBLE',ident)
        check(n['props']['appearance'].get('scrollbarInsets')==spec['scrollbarInsets'],'SCROLL_MEASURED_END_INSETS',ident)
        g=scroll_geometry(n,0);regions=[r['bounds'] for r in inspection.get('paintRegions',[]) if r['componentId']==ident]
        check(len(regions)==2,'SCROLL_PARTS_VISIBLE',ident)
        if len(regions)==2:
            expected=dict(zip(('x','y','width','height'),g['thumb']))
            expected['x']+=observed['bounds']['x'];expected['y']+=observed['bounds']['y']
            check(all(abs(regions[-1][k]-expected[k])<.1 for k in expected),'SCROLL_RENDERED_THUMB_GEOMETRY',ident,expected=expected,actual=regions[-1])
    for spec in observations['dialogs']:
        ident=spec['componentId'];n=nodes[ident];a=n['props']['appearance']
        check(bool(a.get('body'))==spec['bodyRequired'],'DUPLICATE_DIALOG_BODY',ident)
        check(n['props'].get('backdrop')==spec['backdrop'] and not a.get('overlayImage'),'BACKDROP_OWNERSHIP',ident)
        part=a['background'];raw=base64.b64decode(resources[part['image']]['base64']);im=Image.open(io.BytesIO(raw)).convert('RGBA');box=im.getchannel('A').getbbox()
        require(box is not None,'EMPTY_DIALOG_FRAME')
        scale=n['layout']['height']/a['sourceCanvas']['height']
        bottom=(part['layout']['y']+box[3]*part['layout']['height']/im.height)*scale
        actions=[c for c in n.get('children',[]) if c['type']=='Button']
        gap=min(bottom-c['layout']['y']-c['layout']['height'] for c in actions)
        check(gap>=spec['bottomContentInset']-.1,'DIALOG_BOTTOM_CONTENT_INSET',ident,actualGap=gap)
    relation_report=None
    if 'visualRelations' in observations:
        from .visual_relations import check_visual_relations
        relation_report=check_visual_relations(bundle,observations['visualRelations'],inspection)
        checks.extend(relation_report['checks']);issues.extend(relation_report['issues'])
    return dict(kind='ui_visual_observation_check_v1',status='passed' if not issues else 'failed',issues=issues,checks=checks,
                textGeometryCoverage={'checked':[s['componentId'] for s in observations['texts'] if 'geometry' in s], 'undeclared':[s['componentId'] for s in observations['texts'] if 'geometry' not in s]},
                visualRelations=relation_report if relation_report is not None else {'status':'not_declared'},
                human_visual_acceptance=False)
