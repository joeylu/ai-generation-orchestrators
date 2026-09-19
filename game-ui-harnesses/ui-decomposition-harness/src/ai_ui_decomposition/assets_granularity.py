"""Caller-declared visual units; no pixel inference or automatic regrouping."""
from .common import require, digest


def review_granularity(brief):
    spec = brief.get('granularity')
    require(isinstance(spec, dict) and set(spec) == {'units'} and
            isinstance(spec['units'], list), 'GRANULARITY_REQUIRED')
    assets = {a['id']: a for a in brief['assets']}
    elements = {e['id']: e for e in brief['elements']}
    expected = {k for k, e in elements.items() if e['owner'] is not None
                and assets[e['owner']]['role'] != 'background'}
    seen, ids, issues = set(), set(), []
    for unit in spec['units']:
        require(isinstance(unit, dict) and set(unit) ==
                {'id','elements','basis','splits','connections'}, 'GRANULARITY_UNIT_FIELDS')
        key = unit['id']
        require(isinstance(key, str) and key.strip() and key not in ids, 'GRANULARITY_UNIT_ID')
        ids.add(key)
        members = unit['elements']
        require(isinstance(members, list) and members and all(isinstance(k,str) for k in members)
                and len(set(members)) == len(members) and set(members) <= expected
                and not seen.intersection(members), 'GRANULARITY_MEMBERS')
        seen.update(members)
        require(isinstance(unit['basis'], str) and unit['basis'].strip(), 'GRANULARITY_BASIS')
        owners = {elements[k]['owner'] for k in members}
        splits, connections = unit['splits'], unit['connections']
        require(isinstance(splits,list) and isinstance(connections,list), 'GRANULARITY_DECLARATIONS')
        declared = set()
        for split in splits:
            require(isinstance(split,dict) and set(split)=={'asset','reason','evidence'}, 'GRANULARITY_SPLIT_FIELDS')
            asset=split['asset']
            require(isinstance(asset,str) and asset in owners and asset not in declared, 'GRANULARITY_SPLIT_OWNER')
            declared.add(asset)
            require(split['reason'] in ('independent-state','independent-skin','reuse','user-request'), 'GRANULARITY_SPLIT_REASON')
            require(isinstance(split['evidence'],str) and split['evidence'].strip(), 'GRANULARITY_SPLIT_EVIDENCE')
        if len(owners)>1 and declared != owners:
            issues.append('GRANULARITY_SPLIT_UNJUSTIFIED:'+key)
        edges=set()
        for connection in connections:
            require(isinstance(connection,dict) and set(connection)==
                    {'assets','relation','seam','occlusion','alignment'}, 'GRANULARITY_CONNECTION_FIELDS')
            pair=connection['assets']
            require(isinstance(pair,list) and len(pair)==2 and all(isinstance(k,str) for k in pair)
                    and len(set(pair))==2 and set(pair)<=owners, 'GRANULARITY_CONNECTION_OWNER')
            edge=frozenset(pair)
            require(edge not in edges, 'GRANULARITY_DUPLICATE_CONNECTION');edges.add(edge)
            require(connection['relation'] in ('joined','occluding','separate'), 'GRANULARITY_RELATION')
            for field in ('seam','occlusion','alignment'):
                require(isinstance(connection[field],str) and connection[field].strip(), 'GRANULARITY_'+field.upper())
        # Every pair must be reviewed, including explicit separation: a spanning
        # tree would leave unexamined overlaps between non-adjacent declarations.
        if len(edges) != len(owners)*(len(owners)-1)//2:
            issues.append('GRANULARITY_CONNECTIONS_INCOMPLETE:'+key)
    if seen != expected: issues.append('GRANULARITY_INVENTORY_INCOMPLETE')
    result=dict(kind='ui_assets_granularity_review_v1',briefDigest=digest(brief),
                status='blocked' if issues else 'passed',issues=issues,
                policy='preserve-static-units-unless-justified',generationCalls=0,
                automaticSemanticInference=False,
                limitation='Unit membership and semantic evidence are caller-reviewed; declarations do not prove image fidelity.')
    result['digest']=digest(result)
    return result
