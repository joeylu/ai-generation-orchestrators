"""List-to-Text expectations after official consumer 1.1 validation.

These are acceptance records, never an alternative handoff contract.
"""
import copy
from .common import require
from .stateful_list_children import list_children


def list_text_targets(document, source, contexts, value):
    bindings=document.get('valueTextBindings',{})
    selected=[b for b in bindings.get('bindings',[]) if b['sourceId']==source['id']]
    if not selected:return []
    require(bindings.get('version')=='1.1','STATE_LIST_TEXT_VERSION')
    descendants=set()
    def visit(n):
        descendants.add(n['id'])
        for c in n.get('children',[]):visit(c)
    visit(source)
    records=[]
    for binding in selected:
        target,origin,clip=contexts[binding['targetId']]
        require(target['type']=='Text' and target['id'] not in descendants,'STATE_LIST_TEXT_TARGET_PROFILE')
        text=[]
        for part in binding['parts']:
            if isinstance(part,str):text.append(part)
            else:
                require(part['field']=='selectedId','STATE_LIST_TEXT_FIELD')
                mapped={entry['itemId']:entry['text'] for entry in part['items']}
                require(value is None or value in mapped,'STATE_LIST_TEXT_ITEM')
                text.append(part['emptyText'] if value is None else mapped[value])
        child=copy.deepcopy(target);child['props']['text']=''.join(text)
        child['layout'].update(x=0,y=0)
        wrapper={'id':source['id'],'layout':child['layout'],'props':{'style':{'opacity':1}},'children':[child]}
        record=list_children(wrapper,{},origin,clip)[0]
        require(record['visibleRect']==record['rect'],'STATE_LIST_TEXT_TARGET_CLIPPED')
        record.update(sourceId=source['id'],sourceValue=value,fallbackText=target['props']['text'])
        records.append(record)
    return records
