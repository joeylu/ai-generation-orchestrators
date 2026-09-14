"""Explicit producer spacing checks; no inferred ornament geometry or consumer fields."""
import math
from .common import require


def check_layout_spacing(document, plan):
    fields={'version','panelFooters','scrollBottomSpaces'}
    if plan.get('version')=='1.1':fields.add('nonFooterButtons')
    require(set(plan)==fields and plan['version'] in ('1.0','1.1'),'SPACING_PLAN')
    require(isinstance(plan['panelFooters'],list) and isinstance(plan['scrollBottomSpaces'],list),'SPACING_PLAN')
    nodes={}
    def walk(node, parent=None):
        require(node['id'] not in nodes,'SPACING_DUPLICATE_ID')
        nodes[node['id']]=(node,parent)
        for child in node.get('children',[]):walk(child,node['id'])
    walk(document['root'])
    checks=[];footer_ids=set()
    def number(value):
        require(type(value) in (int,float) and math.isfinite(value) and value>=0,'SPACING_NUMBER')
    for entry in plan['panelFooters']:
        require(set(entry)=={'panelId','componentIds','innerBottom','minimumGap','evidence'},'SPACING_FOOTER_FIELDS')
        require(isinstance(entry['evidence'],str) and entry['evidence'].strip(),'SPACING_EVIDENCE')
        number(entry['innerBottom']);number(entry['minimumGap'])
        require(entry['panelId'] in nodes and nodes[entry['panelId']][0]['type']=='Panel','SPACING_PANEL')
        require(entry['innerBottom']<=nodes[entry['panelId']][0]['layout']['height'],'SPACING_INNER_BOTTOM')
        require(isinstance(entry['componentIds'],list) and entry['componentIds'] and len(set(entry['componentIds']))==len(entry['componentIds']),'SPACING_COMPONENTS')
        for ident in entry['componentIds']:
            require(ident not in footer_ids,'SPACING_DUPLICATE_FOOTER');footer_ids.add(ident)
            require(ident in nodes and nodes[ident][1]==entry['panelId'],'SPACING_PARENT')
            layout=nodes[ident][0]['layout'];gap=entry['innerBottom']-layout['y']-layout['height']
            require(gap>=entry['minimumGap'],'SPACING_FOOTER_GAP')
            checks.append({'componentId':ident,'bottomGap':gap})
    declared=set()
    for entry in plan['scrollBottomSpaces']:
        require(set(entry)=={'componentId','bottomWhitespace','reason'},'SPACING_SCROLL_FIELDS')
        ident=entry['componentId'];require(ident not in declared,'SPACING_DUPLICATE_SCROLL');declared.add(ident)
        require(ident in nodes and nodes[ident][0]['type']=='ScrollView','SPACING_SCROLL')
        require(isinstance(entry['reason'],str) and entry['reason'].strip(),'SPACING_EVIDENCE');number(entry['bottomWhitespace'])
        node=nodes[ident][0];children=node.get('children',[])
        require(len(children)==1 and children[0]['type']=='List','SPACING_EXTENT_UNSUPPORTED')
        child=children[0];p=child['props']
        extent=child['layout']['y']+max(0,len(p['items'])*p['itemHeight']-p.get('rowGap',0))
        require(node['props']['contentHeight']==extent+entry['bottomWhitespace'],'SPACING_CONTENT_HEIGHT')
        checks.append({'componentId':ident,'contentExtent':extent,'bottomWhitespace':entry['bottomWhitespace'],
                       'contentHeight':node['props']['contentHeight'],'scrollRange':max(0,node['props']['contentHeight']-node['layout']['height'])})
    require(declared=={ident for ident,(node,_) in nodes.items() if node['type']=='ScrollView'},'SPACING_SCROLL_DECISION_MISSING')
    if plan['version']=='1.1':
        exemptions=plan['nonFooterButtons']
        require(isinstance(exemptions,dict) and all(isinstance(v,str) and v.strip() for v in exemptions.values()),'SPACING_NON_FOOTER_REASON')
        buttons={ident for ident,(node,parent) in nodes.items() if node['type']=='Button' and parent and nodes[parent][0]['type']=='Panel'}
        require(not (set(exemptions)&footer_ids) and set(exemptions)<=buttons,'SPACING_NON_FOOTER_CONFLICT')
        require(buttons<=footer_ids|set(exemptions),'SPACING_BUTTON_DECISION_MISSING')
    return {'kind':'ui_layout_spacing_check_v1','status':'passed','checks':checks,'human_visual_acceptance':False}


def require_export_spacing(document, plan=None):
    """Default export gate: existing archives unaffected; new relevant exports fail closed."""
    from .common import digest
    def walk(node):
        yield node
        for child in node.get('children',[]):yield from walk(child)
    required=any(n['type']=='ScrollView' or (n['type']=='Panel' and any(c['type']=='Button' for c in n.get('children',[]))) for n in walk(document['root']))
    if plan is None:
        require(not required,'SPACING_PLAN_REQUIRED')
        return {'status':'not_applicable','documentDigest':digest(document),'human_visual_acceptance':False}
    require(plan.get('version')=='1.1','SPACING_EXPORT_PLAN_VERSION')
    return {**check_layout_spacing(document,plan),'documentDigest':digest(document),'planDigest':digest(plan)}


def main():
    import argparse
    import json
    from pathlib import Path
    from .common import read_json, write_json
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('document','plan','output'):parser.add_argument('--'+key,type=Path,required=True)
    args=parser.parse_args()
    data=read_json(args.document,max_bytes=64*1024*1024)
    report=check_layout_spacing(data.get('document',data),read_json(args.plan))
    write_json(args.output,report)
    print(json.dumps(report))


if __name__=='__main__':main()
