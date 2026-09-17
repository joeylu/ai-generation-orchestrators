"""Deterministic shop material ownership and official appearance coordinates."""
from copy import deepcopy
import math
from .common import require, digest


def finish_rendering(facts, request):
    request = deepcopy(request)
    def walk(n):
        yield n
        for c in n.get('children', []):
            yield from walk(c)
    nodes = {n['id']: n for n in walk(request['document']['root'])}
    # Filtering controls share the Panel, not tab-page visibility or a new
    # procedural Container surface. Preserve their exact global coordinates.
    content=nodes['tabs-content'];panel=nodes['shop-panel'];index=panel['children'].index(content)
    for child in content['children']:
        child['layout']['x']+=content['layout']['x'];child['layout']['y']+=content['layout']['y']
    panel['children'][index:index+1]=content['children']
    request['acceptanceScope']['components']=[c for c in request['acceptanceScope']['components'] if c['componentId']!='tabs-content']
    nodes = {n['id']: n for n in walk(request['document']['root'])}
    for n in nodes.values():
        if n['type']=='Text':
            minimum=math.ceil(n['props']['style']['fontSize']*1.25)
            if n['layout']['height']<minimum:
                n['layout']['y']-=(minimum-n['layout']['height'])/2
                n['layout']['height']=minimum
            n['props']['lineHeight']=min(n['props']['lineHeight'],n['layout']['height'])
    materials = request['materials']
    bindings = request['appearance']['bindings']
    by_binding = {b['componentId']: b for b in bindings}
    marker = 'shop-facts-input-v1:' + digest(facts)
    # Dynamic item names can be longer than the observed initial selection.
    # Keep its first-line origin, font and horizontal reservation; use only
    # free vertical space before the next footer control for a second line.
    selected = nodes['selected-name']
    available = facts['footer']['checkbox']['rect'][1] - facts['footer']['selectedName']['bounds'][1] - 4
    two_lines = math.ceil(selected['props']['lineHeight'] + selected['props']['style']['fontSize'] * 1.25)
    if available >= two_lines:
        selected['props']['wrap'] = 'word'
        selected['layout']['height'] = max(selected['layout']['height'], two_lines)
        request['acceptanceScope']['derivedTestStates'].append(dict(componentId='selected-name', basis='contract-derived',
            description='Long selected names may wrap within two lines in the existing free footer area; preserve first-line origin, font, width and original observed selection.'))
    nodes['quantity-value']['props']['style']['textColor']=facts['theme']['colors']['quantityText']
    nodes['shop-total']['props']['style']['fontWeight']='normal'
    def rect(values, space):
        return dict(coordinateSpace=space, **dict(zip(('x','y','width','height'), values)))
    def local(values, parent):
        return [values[0]-parent[0], values[1]-parent[1], *values[2:]]

    value_rect=facts['footer']['quantity']['valueRect']
    field=dict(id='quantity-field',type='Image',layout=dict(zip(('x','y','width','height'),local(value_rect,facts['panel']['rect']))),
        props=dict(source='layers/quantity-field.png',fit='stretch',drawBackground=False,
                   style=deepcopy(nodes['background']['props']['style'])))
    siblings=nodes['shop-panel']['children']
    siblings.insert(siblings.index(nodes['quantity-value']),field)
    nodes[field['id']]=field
    materials.append(dict(layerId=field['id'],componentId=field['id'],rect=value_rect,
        description=marker+' Empty quantity number field border and surface; no digits or text.',groupId=None))
    bindings.append(dict(componentId=field['id'],componentType='Image',parts=[dict(role='image',layerId=field['id'])]))
    request['acceptanceScope']['components'].append(dict(componentId=field['id'],mode='compare',reason='Observed quantity field surface, separate from its dynamic number.'))

    # An empty Panel owns its crown and separators once. Child controls own
    # their surfaces; glyphs and all semantic text remain separate.
    panel_material = next(m for m in materials if m['componentId']=='shop-panel')
    panel_material['description'] += ' One complete outer frame and crown; empty interior. Remove all child controls, product slots, icons, ordinary text and numbers.'

    for cid, key, label in (('quantity-minus','minusRect','−'),('quantity-plus','plusRect','+')):
        node = nodes[cid]; r = facts['footer']['quantity'][key]
        materials.append(dict(layerId=cid, componentId=cid, rect=r,
            description=marker+' Empty quantity step button; no symbol or text.', groupId=None))
        # A centered step glyph does not own the whole button surface. Keep a
        # real frame reservation for both visual layout and material sampling.
        layout=rect([r[2]*.2,r[3]*.125,r[2]*.6,r[3]*.75],'target-component-local')
        bindings.append(dict(componentId=cid,componentType='Button',parts=[dict(role='background',layerId=cid)],
                             states=dict(button=dict(labelLayout=layout))))
    by_binding = {b['componentId']: b for b in bindings}

    tabs = by_binding['shop-tabs']['states']['tabs']
    for item in tabs['items']:
        item['layout'] = rect(item['layout'],'target-component-local')
        for key in ('labelLayout','hitArea'):
            item[key]['coordinateSpace']='target-item-local'
    for item in tabs['icons']:
        item['iconLayout']['coordinateSpace']='target-item-local'
        item['activeIconLayout']['coordinateSpace']='target-item-local'
    tabs['labelLayout']=deepcopy(tabs['items'][0]['labelLayout'])
    tabs['hitArea']=deepcopy(tabs['items'][0]['hitArea'])
    tabs['activeTextColor']=facts['theme']['colors']['activeTabText']
    check = by_binding['remember-checkbox']['states']
    check['checkBox']=check.pop('checkbox')
    check_label=check['checkBox']['labelLayout']
    minimum_height=nodes['remember-checkbox']['props']['style']['fontSize']*1.25
    if check_label['height']<minimum_height:
        check_label['y']-=(minimum_height-check_label['height'])/2
        check_label['height']=minimum_height

    # List sample layers are attached to an explicit source row and contain
    # neither labels nor selected checkmarks. The native consumer repeats them.
    items=facts['rows']['items']; view=facts['rows']['viewport']
    pitch=facts['runtimeDerivations']['rowSpacing']['outputPitchPx']
    selected_index=next(i for i,v in enumerate(items) if v['selected'])
    normal_index=next((i for i,v in enumerate(items) if not v['selected']), selected_index)
    list_binding=by_binding['shop-list']
    background_policy=facts['rows'].get('backgroundPolicy')
    if background_policy is not None:
        list_binding['states']['list']['backgroundPolicy']=deepcopy(background_policy)
        if background_policy['mode']=='parent':
            removed={p['layerId'] for p in list_binding['parts'] if p['role']=='background'}
            list_binding['parts']=[p for p in list_binding['parts'] if p['role']!='background']
            materials[:]=[m for m in materials if m['layerId'] not in removed]
        request['acceptanceScope']['derivedTestStates'].append(dict(componentId='shop-list',basis='contract-derived',
            description='Explicit List background policy '+background_policy['mode']+': '+facts['rows']['backgroundEvidence']))
    for part in list_binding['parts']:
        if part['role'] in ('row','selected-row'):
            index=selected_index if part['role']=='selected-row' else normal_index
            part['itemId']=items[index]['id']
            mat=next(m for m in materials if m['layerId']==part['layerId'])
            mat['rect'][1]=view[1]+index*pitch
            mat['description']+=' Empty row surface, no product picture, coin, text or numbers.'
            if part['role']=='selected-row' and facts['rows']['template'].get('markGlyphRect'):
                mat['description']+=f" Keep the observed selected checkmark only in row-local {facts['rows']['template']['markGlyphRect']}, within reserved strip {facts['rows']['template']['markRect']}. This is selected-row feedback, never bake it into the scene or ordinary row."
            else:
                mat['description']+=' No checkmark.'
    for key,value in list_binding['states']['list'].items():
        if key!='backgroundPolicy':value['coordinateSpace']='target-item-local'

    # Every Button uses its authored label region through the formal contract.
    for binding in bindings:
        if binding['componentType']!='Button':
            continue
        node=nodes[binding['componentId']]
        if binding['componentId'] in ('quantity-minus','quantity-plus'):
            node['props']['style']['textColor']=facts['theme']['colors']['quantityText']
        else:
            role=binding['componentId'].removeprefix('button-')
            node['props']['style']['textColor']=next(b['textColor'] for b in facts['footer']['buttons'] if b['role']==role)
        layout=binding['states']['button']['labelLayout']
        binding['states']['button']['labelLines']=dict(version='1.0',coordinateSpace='target-component-local',
            lines=[dict(text=node['props']['label'],fontSize=node['props']['style']['fontSize'],
                        fontWeight='normal',align='center',layout={k:layout[k] for k in ('x','y','width','height')})])

    # Bounded material families are compiled once; same-size shared coins retain
    # separate placements and derive from one canonical source.
    groups={'Tabs':'shop-tabs','Input':'shop-input','Select':'shop-select',
            'List':'shop-list','CheckBox':'shop-checks','Button':'shop-buttons','Image':'shop-icons'}
    for material in materials:
        kind=nodes[material['componentId']]['type']
        material['groupId']=None if material['layerId']=='background' or kind=='Panel' else groups[kind]
    request['boardPolicies']={g:dict(version='1.2',mode='foreground-gap-row',target_padding=2)
                              for g in sorted({m['groupId'] for m in materials if m['groupId']})}

    # Allocated row text boxes are not observed glyph ink bounds. Retain region
    # checks for every string; only title/subtitle have explicit extent targets.
    visual=request['visualObservations']
    for cid, key in (('quantity-minus','minusRect'),('quantity-plus','plusRect')):
        visual['texts'].append(dict(componentId=cid,text=nodes[cid]['props']['label'],
            minFontSize=nodes[cid]['props']['style']['fontSize'],
            region=deepcopy(facts['footer']['quantity'][key])))
    geometry_ids={'shop-title','shop-subtitle'} & nodes.keys()
    for observation in visual['texts']:
        cid=observation['componentId']
        observation['minFontSize']=nodes[cid]['props']['style']['fontSize']
        if 'region' not in observation and 'geometry' in observation:
            observation['region']=deepcopy(observation['geometry']['referenceBounds'])
        if isinstance(observation.get('region'),list):
            observation['region']=dict(zip(('x','y','width','height'),observation['region']))
        if cid not in geometry_ids:
            observation.pop('geometry',None)
        elif 'geometry' in observation:
            bounds=observation['geometry']['referenceBounds']
            observation['geometry']['maxCenterOffset']=[max(2,bounds[2]*.03),max(2,bounds[3]*.2)]
            observation['geometry']['evidence']='Source-estimated heading extent with declared system-font tolerance; not exact source glyph recovery.'
    visual['requiredTextGeometryIds']=sorted(geometry_ids)
    # Unshown popup options are derived test states, never original visible text.
    selected_sort=next(o['label'] for o in facts['sort']['options'] if o['value']==facts['sort']['selectedValue'])
    visual['texts']=[t for t in visual['texts'] if t['componentId']!='sort-select' or t['text']==selected_sort]
    unique={}
    for row in visual['texts']:
        unique[(row['componentId'],row['text'])]=row
    visual['texts']=list(unique.values())
    for observation in visual['texts']:
        for index,item in enumerate(facts['rows']['items']):
            if observation['componentId'] in {f"row-{role}-{item['id']}" for role in ('name','description','price')}:
                delta=index*(facts['runtimeDerivations']['rowSpacing']['outputPitchPx']-facts['rows']['sourcePitchPx'])
                if delta:
                    observation['referenceRegion']=deepcopy(observation['region'])
                    observation['region']['y']+=delta
                    observation['runtimeRegionEvidence']=facts['runtimeDerivations']['rowSpacing']['evidence']
    frame_types={'Panel','Button','Input','Select','List'}
    frame_roles={'background','tab','active-tab','row','selected-row','popup'}
    layer_roles={p['layerId']:p['role'] for b in bindings for p in b['parts']}
    geometry=[]
    for m in materials:
        kind=nodes[m['componentId']]['type']
        if kind not in frame_types|{'Tabs'} or layer_roles[m['layerId']] not in frame_roles:
            continue
        width,height=m['rect'][2:]
        padding=2 if m['groupId'] else 0
        require(min(width,height)>2*padding,'SHOP_FACTS_FRAME_TOO_SMALL')
        geometry.append(dict(materialId=m['layerId'],alphaThreshold=1,
            minimumOccupancy=dict(width=min(.9,(width-2*padding)/width),height=min(.8,(height-2*padding)/height)),
            reservedRects=[],textWorldRects=[],imageWorldRect=None))
    request['visibleGeometryRequirements']=geometry
    scope=request['acceptanceScope']['derivedTestStates']
    d=facts['runtimeDerivations']
    scope.extend([
        dict(componentId='shop-list',basis='contract-derived',description=
             f"Row pitch {facts['rows']['sourcePitchPx']} -> {d['rowSpacing']['outputPitchPx']}; "
             f"{d['rowSpacing']['evidence'] or 'Observed pitch retained.'} {d['categoriesEvidence']} "
             f"Search policy: {d['search']}. Sorting: {facts['sort']['evidence']}"),
        dict(componentId='quantity-value',basis='contract-derived',description=
             f"Explicit quantity limits: {d['quantityBounds']}; this is not an observed unseen value."),
        dict(componentId='background',basis='contract-derived',description=facts['background']['semantics']),
        dict(componentId='balance-coin',basis='contract-derived',description=facts['sharedCurrency']['evidence']),
        dict(componentId='shop-title',basis='contract-derived',description=
             f"Default Arial system typography with explicit role sizes {facts['theme']['fontSizesPx']}; "
             "allocated non-heading text boxes are containment regions, not measured source glyph ink.")
    ])
    from .shop_material_observations import apply_observations
    apply_observations(facts,request)
    return request
