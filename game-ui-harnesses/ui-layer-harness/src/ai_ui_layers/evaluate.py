"""Offline M1 first-answer checks and previews. Never edits the answer or calls a model."""
import argparse
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR, ROUND_CEILING
import hashlib
import json
from pathlib import Path
import time

from jsonschema import Draft202012Validator
from PIL import Image, ImageDraw
from .card_geometry import repeated_card_height_outlier


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    def invalid(value):
        raise ValueError('NONFINITE_JSON_NUMBER')
    if path.stat().st_size > 2_097_152:
        raise ValueError('JSON_TOO_LARGE')
    return json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=pairs, parse_constant=invalid)


def save(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)


def pixel_box(box, width, height):
    # Convert decimal model coordinates without binary float rounding inflation.
    return [int((Decimal(str(v))*scale).to_integral_value(rounding=ROUND_FLOOR if i < 2 else ROUND_CEILING))
            for i, (v, scale) in enumerate(zip(box, [width, height, width, height]))]


def check_relations(plan):
    issues = []
    outlier = repeated_card_height_outlier(plan)
    if outlier:
        group, outlier_id, typical = outlier
        issues.append({'code': 'REPEATED_CARD_HEIGHT_OUTLIER_REVIEW', 'category': 'geometry',
                       'materialIds': [mid for mid, _ in group],
                       'suspectedOutlierId': outlier_id,
                       'medianHeightNorm': round(typical, 6),
                       'peerHeightEdgeAlternativesNorm': {
                           'topIfBottomCorrect': round(next(box[3] for mid, box in group if mid == outlier_id) - typical, 6),
                           'bottomIfTopCorrect': round(next(box[1] for mid, box in group if mid == outlier_id) + typical, 6)},
                       'requires': 'source-review-and-repair',
                       'basis': 'aligned, nonoverlapping card materials; alternative edges are search anchors, not automatic edits'})
    for material in plan['materials']:
        texts=material.get('preserveText',[])
        if len(texts)!=len(set(texts)):issues.append({'code':'DUPLICATE_PRESERVE_TEXT','id':material['id']})
    scoped = any(k in plan for k in ('backgroundMode','textPolicy')) or any('preserveText' in m for m in plan['materials'])
    if scoped and (plan.get('backgroundMode') not in ('scene-only','preserve-underlay') or plan.get('textPolicy')!='remove-business-text' or any('preserveText' not in m for m in plan['materials'])):
        issues.append({'code':'INCOMPLETE_CONTENT_SCOPE'})
    if plan.get('surfaceDetails'):
        issues.append({'code':'RETIRED_DRAWING_PLAN_REQUIRES_REPLAN'})
    explicit = plan.get('kind') == 'ui_visual_plan_v5'
    for field in ('materials', 'objects', 'textRegions'):
        ids = [r['id'] for r in plan.get(field, [])]
        if len(set(ids)) != len(ids):
            issues.append({'code': 'DUPLICATE_ID', 'field': field})
    materials = {r['id']: r for r in plan['materials']}
    used = {r['materialId'] for r in plan['objects']}
    for key in sorted(used - materials.keys()):
        issues.append({'code': 'MISSING_MATERIAL', 'id': key})
    for key in sorted(materials.keys() - used):
        issues.append({'code': 'UNUSED_MATERIAL', 'id': key})
    backgrounds = [r for r in plan['materials'] if r['role'] == 'background']
    foreground = [r for r in plan['materials'] if r['role'] == 'foreground']
    if len(backgrounds) != 1:
        issues.append({'code': 'BACKGROUND_COUNT'})
    elif any(r['zOrder'] <= backgrounds[0]['zOrder'] for r in foreground):
        issues.append({'code': 'BACKGROUND_ORDER'})
    if plan.get('kind') not in ('ui_visual_plan_v4','ui_visual_plan_v5') and len({r['zOrder'] for r in foreground}) != len(foreground):
        issues.append({'code': 'FOREGROUND_ORDER_DUPLICATE'})
    if plan.get('kind') in ('ui_visual_plan_v4','ui_visual_plan_v5'):
        # v5 uses declared material regions; preserve per-object checks for historical v4.
        ordered = sorted(foreground, key=lambda row: row['id'])
        objects = {m['id']: ([m] if explicit else [o for o in plan['objects'] if o['materialId'] == m['id']])
                   for m in ordered}
        for i, a in enumerate(ordered):
            for b in ordered[i+1:]:
                if a['zOrder'] != b['zOrder']:
                    continue
                overlaps = []
                for x in objects[a['id']]:
                    for y in objects[b['id']]:
                        l,t,r,bt = x['bboxNorm']; ll,tt,rr,bb = y['bboxNorm']
                        if max(l,ll) < min(r,rr) and max(t,tt) < min(bt,bb):
                            overlaps.append([x['id'], y['id']])
                if overlaps:
                    issues.append({'code':'SAME_LAYER_OVERLAP_REVIEW', 'category':'geometry',
                                   'materialIds':[a['id'], b['id']], ('materialPairs' if explicit else 'objectPairs'):sorted(overlaps),
                                   'requires':'M2', 'basis':'declared material regions; not alpha overlap' if explicit else 'estimated object boxes; not alpha overlap'})
    bg_objects = [r for r in plan['objects'] if r['kind'] == 'background']
    if len(bg_objects) != 1 or (not explicit and bg_objects[0]['bboxNorm'] != [0, 0, 1, 1]) or len(backgrounds) != 1 or bg_objects[0]['materialId'] != backgrounds[0]['id']:
        issues.append({'code': 'BACKGROUND_OBJECT'})
    if explicit and len(backgrounds)==1 and backgrounds[0]['bboxNorm'] != [0,0,1,1]:
        issues.append({'code':'BACKGROUND_REGION'})
    for field in (('materials','objects') if explicit else ('objects', 'textRegions')):
        for row in plan.get(field, []):
            if row.get('bboxNorm') is not None:
                l,t,r,b = row['bboxNorm']
                if not (l < r and t < b):
                    issues.append({'code': 'BOX_ORDER', 'id': row['id']})
                if explicit and field=='objects' and row['materialId'] in materials:
                    ml,mt,mr,mb=materials[row['materialId']]['bboxNorm']
                    if not (ml<=l and mt<=t and r<=mr and b<=mb):
                        issues.append({'code':'OBJECT_OUTSIDE_MATERIAL','id':row['id'],'materialId':row['materialId']})
            if row.get('kind') == 'unknown' and not any(row['id'] in s for s in plan['unknowns']):
                issues.append({'code': 'UNKNOWN_WITHOUT_NOTE', 'id': row['id']})
    return issues


def draw_order(plan, source_sha256):
    """Derived unique indices; never change the source plan or resolve ambiguous overlaps."""
    if check_relations(plan):
        raise ValueError('UNRESOLVED_PLAN_RELATIONS')
    ordered = sorted(plan['materials'], key=lambda row:(row['zOrder'], row['id']))
    return {'kind':'ui_derived_draw_order_v1', 'sourcePlanSha256':source_sha256,
            'policy':'ascending-zOrder-then-ascii-material-id',
            'basis':'model-estimated geometry; requires visual review before production',
            'materials':[{'id':row['id'],'zOrder':row['zOrder'],'drawIndex':i}
                         for i,row in enumerate(ordered)]}


def evaluate(run, output):
    started = time.perf_counter()
    run, output = Path(run), Path(output)
    output.mkdir(parents=True, exist_ok=False)
    result = {'kind': 'm1_offline_diagnostic_v1', 'evaluatedAt': datetime.now(timezone.utc).isoformat(),
              'status': 'rejected', 'issues': [], 'generationCalls': 0, 'human_visual_acceptance': False,
              'reviewStatus': 'not_reviewed', 'productionReady': False}
    try:
        request, receipt, schema = read(run/'request.json'), read(run/'answer-received.json'), read(run/'schema.json')
        for name in ('reference.png', 'prompt.md', 'schema.json'):
            if digest(run/name) != request['inputs'][name]:
                raise ValueError('INPUT_CHANGED')
        if digest(run/'draft.json') != receipt['responseSha256'] or digest(run/'request.json') != receipt['requestSha256']:
            raise ValueError('RECEIPT_MISMATCH')
        if (run/'draft.json').stat().st_size != receipt['responseBytes']:
            raise ValueError('RESPONSE_SIZE_MISMATCH')
        begin = datetime.fromisoformat(request['startedAt'])
        end = datetime.fromisoformat(receipt['receivedAt'])
        if begin.tzinfo is None or end.tzinfo is None or not (begin <= end <= datetime.now(timezone.utc)):
            raise ValueError('TIMING_INVALID')
        seconds = (end-begin).total_seconds()
        if abs(seconds-receipt['elapsedSeconds']) > .01:
            raise ValueError('TIMING_MISMATCH')
        plan = read(run/'draft.json')
        Draft202012Validator.check_schema(schema)
        result['issues'] = [{'code': 'SCHEMA', 'path': '/'+ '/'.join(map(str,e.absolute_path)), 'message': e.message}
                            for e in Draft202012Validator(schema).iter_errors(plan)]
        if not result['issues']:
            result['issues'] = check_relations(plan)
        result.update(requestToPersistenceSeconds=seconds, timingScope=request['timingScope'],
                      responseSha256=receipt['responseSha256'], responseBytes=receipt['responseBytes'])
        if not result['issues']:
            result.update(status='structure_passed', materialCount=len(plan['materials']), objectCount=len(plan['objects']),
                          textRegionCount=len(plan.get('textRegions', [])), unknownCount=len(plan['unknowns']))
            render(run/'reference.png', plan, output)
            save(output/'draw-order.json', draw_order(plan, receipt['responseSha256']))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        result['issues'].append({'code': str(exc) if type(exc) is ValueError and str(exc).isupper() else 'INVALID_INPUT'})
    result['evaluationSeconds'] = time.perf_counter()-started
    save(output/'report.json', result)
    return result


def render(reference, plan, output):
    with Image.open(reference) as source:
        base = source.convert('RGB')
    width,height = base.size
    colors = ['#ff4c4c','#10cfff','#ffcf00','#46e176','#d893ff','#ff8c38']
    ordered = sorted(plan['materials'], key=lambda r:(r['zOrder'],r['id']))
    palette = {r['id']:colors[i%len(colors)] for i,r in enumerate(ordered)}
    geometry = {'objects': [], 'materials': [], 'textRegions': []}
    lines = ['# M1 素材清单（首稿诊断，未复核）', '', '| 素材 | 类型 | Z | 对象 |', '|---|---|---:|---|']
    def escape(s): return s.replace('|','\\|').replace('\n',' ')
    for material in ordered:
        rows = [r for r in plan['objects'] if r['materialId']==material['id']]
        if plan.get('kind')=='ui_visual_plan_v5':
            box=pixel_box(material['bboxNorm'],width,height)
        else:
            boxes = [pixel_box(r['bboxNorm'],width,height) for r in rows]
            box = [min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
        geometry['materials'].append({'id':material['id'],'rectLTRB':box,'centerXY':[(box[0]+box[2])/2,(box[1]+box[3])/2]})
        lines.append(f"| {escape(material['id'])}: {escape(material['label'])} | {material['role']} | {material['zOrder']} | "+'; '.join(escape(r['id']) for r in rows)+' |')
    for key in (('materials','objects') if plan.get('kind')=='ui_visual_plan_v5' else ('objects','textRegions')):
        if key not in plan:
            continue
        canvas = base.copy(); draw = ImageDraw.Draw(canvas)
        lines.extend(['', '## '+key, '', '| 编号 | ID / 分类 | 描述 | 像素框 LTRB |', '|---:|---|---|---|'])
        for i,row in enumerate(plan[key],1):
            if row.get('bboxNorm') is None:
                lines.append(f"| {i} | {escape(row['id'])} / {row.get('kind','')} | {escape(row['label'])} | auxiliary box not requested |")
                continue
            box=pixel_box(row['bboxNorm'],width,height)
            if key!='materials':
                geometry[key].append({'id':row['id'],'rectLTRB':box,'centerXY':[(box[0]+box[2])/2,(box[1]+box[3])/2]})
            color=palette[row['id']] if key=='materials' else palette[row['materialId']] if key=='objects' else '#ff4c4c'
            l,t,r,b=box
            draw.rectangle([l,t,min(width-1,r-1),min(height-1,b-1)],outline=color,width=3)
            x,y=min(l+3,width-26),min(t+3,height-18)
            draw.rectangle([x,y,x+24,y+16],fill='#101010')
            draw.text((x+3,y+2),str(i),fill=color)
            lines.append(f"| {i} | {escape(row['id'])} / {row.get('kind','text')} | {escape(row['label'])} | {box} |")
        canvas.save(output/(key+'-overlay.png'))
    lines.extend(['','## 未知项','']+[f'- {escape(s)}' for s in plan['unknowns']])
    (output/'inventory.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    geometry['basis']=('declared material regions; auxiliary object boxes do not define crops' if plan.get('kind')=='ui_visual_plan_v5' else 'material envelopes of object boxes')+'; model-estimated, deterministic outward rounding; centers derived, not measured alpha'
    save(output/'geometry.json',geometry)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    report=evaluate(args.run,args.output)
    print(json.dumps(report,ensure_ascii=False))
    raise SystemExit(0 if report['status']=='structure_passed' else 1)
