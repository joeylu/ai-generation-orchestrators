"""Text Input states; test text is contract-derived, never reference evidence."""
from .common import require


def input_states(node):
    p=node['props']
    require(p.get('inputType') == 'text', 'STATE_CAPABILITY_MISSING:INPUT_TYPE')
    require(type(p.get('maxLength')) is int and p['maxLength'] > 0, 'STATE_INPUT_MAX_LENGTH')
    if not p['enabled']: return ['initial','disabled']
    if p['readOnly']: return ['initial','readonly']
    return ['initial','empty','edited','limit']


def input_value(node, name):
    p=node['props']
    if name in ('initial','readonly','disabled'):return p['value']
    if name=='empty':return ''
    if name=='edited':return 'QA'[:p['maxLength']]
    require(p['maxLength']<=256,'STATE_CAPABILITY_MISSING:INPUT_LIMIT_OVER_256')
    return ('Q'*p['maxLength'])
