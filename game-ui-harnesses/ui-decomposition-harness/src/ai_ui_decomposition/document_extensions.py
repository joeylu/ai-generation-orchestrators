"""Producer checks for existing consumer contracts; no runtime field translation."""
import math
from .common import require, digest


def walk(node):
    yield node
    for child in node.get('children', []):
        yield from walk(child)


def item_offsets(node):
    """Canonical source row offsets, independent of current filtering/sorting."""
    p = node.get('props', {})
    if node.get('type') != 'List' or 'itemContents' not in p:
        return {}
    value = p['itemContents']
    require(isinstance(value, dict) and set(value) == {'version','coordinateSpace','labelMode','items'}, 'ITEM_CONTENTS_SCHEMA')
    require(value['version'] == '1.0', 'ITEM_CONTENTS_VERSION')
    require(value['coordinateSpace'] == 'item-local' and value['labelMode'] == 'children', 'ITEM_CONTENTS_MODE')
    items = {item['id']: index for index, item in enumerate(p['items'])}
    children = {child['id']: child for child in node.get('children', [])}
    require(isinstance(value['items'], list) and len(value['items']) == len(items), 'ITEM_CONTENTS_ITEM_COVERAGE')
    result = {}; seen = set()
    for row in value['items']:
        require(isinstance(row, dict) and set(row) == {'itemId','childIds'}, 'ITEM_CONTENTS_ROW')
        ident = row['itemId']
        require(isinstance(ident,str) and ident in items and ident not in seen, 'ITEM_CONTENTS_ITEM_REFERENCE')
        seen.add(ident)
        require(isinstance(row['childIds'],list) and row['childIds'], 'ITEM_CONTENTS_CHILD_COVERAGE')
        for cid in row['childIds']:
            require(isinstance(cid,str) and cid in children and cid not in result, 'ITEM_CONTENTS_CHILD_REFERENCE')
            child=children[cid];r=child['layout']
            require(child['type'] in {'Image','Text'} and not child.get('children'), 'ITEM_CONTENTS_CHILD_TYPE')
            require(all(type(r[k]) in (int,float) and math.isfinite(r[k]) for k in ('x','y','width','height')),
                    'ITEM_CONTENTS_CHILD_BOUNDS')
            require(min(r['x'],r['y'])>=0 and min(r['width'],r['height'])>0 and
                    r['x']+r['width']<=node['layout']['width'] and
                    r['y']+r['height']<=p['itemHeight']-p.get('rowGap',0), 'ITEM_CONTENTS_CHILD_BOUNDS')
            result[cid]=items[ident]*p['itemHeight']
    require(set(result)==set(children), 'ITEM_CONTENTS_CHILD_COVERAGE')
    return result


def check_extensions(document, capabilities=None):
    """Presence/version and producer coverage. CLI owns full linkage validation."""
    nodes={n['id']:n for n in walk(document['root'])}
    linked=set(); checks=[]
    if 'componentLinkages' in document:
        value=document['componentLinkages']
        require(isinstance(value,dict) and value.get('version')=='1.0', 'COMPONENT_LINKAGES_VERSION')
        require(isinstance(value.get('pipelines'),list) and value['pipelines'], 'COMPONENT_LINKAGES_PIPELINES')
        for pipeline in value['pipelines']:
            cid=pipeline['listId']
            require(cid in nodes and nodes[cid]['type']=='List' and cid not in linked, 'COMPONENT_LINKAGES_LIST')
            q=pipeline['quantity']
            require((q['max']-q['min'])/q['step']<=128, 'LINKAGE_ACCEPTANCE_STEP_BUDGET')
            require(any(m['category'] is None for m in pipeline['category']['map']), 'LINKAGE_ACCEPTANCE_ALL_CATEGORY_REQUIRED')
            linked.add(cid)
            checks.append(dict(componentId=cid,profile='component-linkages-v1',version='1.0'))
    if 'linkageState' in document:
        require(bool(linked) and isinstance(document['linkageState'],dict) and document['linkageState'].get('version')=='1.0', 'LINKAGE_STATE_VERSION')
    for cid,node in nodes.items():
        if node['type']!='List':continue
        require(not (cid in linked and node.get('children')) or 'itemContents' in node['props'], 'ITEM_CONTENTS_REQUIRED')
        if 'itemContents' in node['props']:
            item_offsets(node)
            children={c['id']:c for c in node.get('children',[])}
            for item in node['props']['itemContents']['items']:
                placed=[]
                for ident in item['childIds']:
                    r=children[ident]['layout']
                    require(not any(max(r['x'],p['x'])<min(r['x']+r['width'],p['x']+p['width']) and
                                    max(r['y'],p['y'])<min(r['y']+r['height'],p['y']+p['height']) for p in placed),
                            'ITEM_CONTENTS_CHILD_OVERLAP:'+ident)
                    placed.append(r)
            checks.append(dict(componentId=cid,profile='item-contents-v1',version='1.0'))
    if capabilities is not None:
        declared={(c['id'],p) for c in capabilities for p in c['profiles'] if p in {'component-linkages-v1','item-contents-v1'}}
        required={(c['componentId'],c['profile']) for c in checks}
        require(declared==required, 'DOCUMENT_EXTENSION_CAPABILITY_COVERAGE')
    return dict(kind='ui_document_extension_preflight_v1',checks=checks,documentSha256=digest(document),
                status='supported' if checks else 'not_applicable',acceptance='not_run',human_visual_acceptance=False)


def linked_component_ids(document):
    result=set()
    for p in document.get('componentLinkages',{}).get('pipelines',[]):
        result.update([p['listId'],p['search']['inputId'],p['category']['tabsId'],p['sort']['selectId'],
                       p['quantity']['decrementId'],p['quantity']['incrementId'],p['purchase']['buttonId']])
    return result


def validate_linkage_receipt(receipt, matrix):
    require(receipt.get('kind')=='ui_linkage_browser_v1' and receipt.get('human_visual_acceptance') is False and
            receipt.get('status')=='passed' and receipt.get('bundleSha256')==matrix['bundleSha256'] and
            receipt.get('handoffSha256')==matrix['handoffSha256'], 'LINKAGE_BROWSER_RECEIPT_INVALID')
    require(set(receipt.get('coveredComponentIds',[]))==set(matrix['linkedComponentIds']) and
            bool(receipt.get('checks')) and all(c.get('pass') is True for c in receipt['checks']), 'LINKAGE_BROWSER_COVERAGE_REQUIRED')
