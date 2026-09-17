"""Producer-only planning profiles, never fields added to a consumer handoff.

An explicit request describes required behavior before any media is generated.
Supported means a local route exists, not that a future sample passed acceptance.
"""
from .common import digest, read_json, require, write_json

# Each base is bounded by the current consumer and producer acceptance path.
PROFILES = {
    'Image': {'base','region','contain','cover','stretch'},
    'Text': {'base','word-wrap','ellipsis','system-font'},
    'Container': {'base','nested-children'},
    'Button': {'base','runtime-feedback','image-children','per-line-text-layout'},
    'Switch': {'base','state-images-v1','state-labels'},
    'CheckBox': {'base','binary-mark'},
    'RadioGroup': {'base','explicit-option-layout'},
    'Input': {'base','text','editing-v1.1','read-only','disabled'},
    'Select': {'base','equal-height-options','option-icons-v1','field-text-color','menu-highlights-v1'},
    'ProgressBar': {'base','left-to-right','inner-fill-mask','value-text'},
    'Slider': {'base','horizontal','fractional-step','value-text'},
    'ScrollView': {'base','vertical','zero-range','always-visible','insets-v1','authorized-bottom-space'},
    'List': {'base','equal-height-rows','row-gap','structured-image-text-child-acceptance','selected-label-text-binding','component-linkages-v1','item-contents-v1','list-background-v1'},
    'Panel': {'base','optional-header','nested-children'},
    'Dialog': {'base','modal','non-modal','optional-body','nested-children'},
    'Tabs': {'base','horizontal','vertical-v1','per-tab-icons','native-items'},
}
GAPS = {
    'Image': {'runtime-atlas-animation':'Static raster delivery does not validate image animation.'},
    'Text': {'rich-text':'Text is one style, not inline rich text.', 'font-matching':'System font fallback is not reference font recovery.'},
    'Container': {'arbitrary-transform':'General rotated/scaled acceptance is not implemented.'},
    'Button': {'state-images':'Only one base image; pressed/hover feedback is runtime presentation.'},
    'Switch': {'legacy-full-appearance':'A legacy single pair is importable, not full ON/OFF appearance evidence.'},
    'CheckBox': {'indeterminate':'Only checked boolean; no tri-state contract.', 'state-images':'No per-state box-image extension.'},
    'RadioGroup': {'per-option-disabled':'No per-option enabled field.', 'multi-select':'Radio selection is one selectedId.'},
    'Input': {'password':'Consumer editing supports password, but generic producer state acceptance only text.',
              'email':'Generic producer Input acceptance only text.', 'number':'Generic producer Input acceptance only text.',
              'multiline':'No multiline Input contract.', 'ime':'IME requires separate device evidence.',
              'limit-over-256':'Generic producer limit input test is bounded to 256 characters.'},
    'Select': {'unequal-height-options':'One uniform safe content row height.', 'above-popup':'Only below-start popup binding.',
               'multi-select':'One selectedId.', 'state-dependent-option-icons':'Option icon is shared across hover/selection.',
               'translucent-popup-readability':'No generic compositing/readability gate for translucent menu content surfaces.'},
    'ProgressBar': {'vertical':'Only left-to-right fill.', 'right-to-left':'Only left-to-right fill.', 'radial':'No radial fill contract.'},
    'Slider': {'vertical':'Only horizontal endpoints and left-to-right fill.', 'range':'Only one value and thumb.'},
    'ScrollView': {'horizontal':'Semantic consumer scrolling exists; raster chrome and producer acceptance are vertical.',
                   'two-axis':'No two-axis raster chrome acceptance.', 'arbitrary-short-thumb':'Thumb length follows real content ratio, not desired reference silhouette.'},
    'List': {'grid':'Only text-row template.', 'unequal-height-rows':'One itemHeight.', 'multi-select':'One selectedId.',
             'per-item-state-images':'One normal and one selected row template, not per-item state skins.'},
    'Panel': {'automatic-nine-slice':'No inferred nine-slice insets or frame ownership.'},
    'Dialog': {'draggable':'No drag/resize Dialog contract.', 'resizable':'No drag/resize Dialog contract.'},
    'Tabs': {'wrapped':'No multi-row wrapping.', 'right-rail':'Vertical 1.0 requires x=0.', 'per-tab-disabled':'No per-tab enabled field.'},
}


def audit(request):
    require(isinstance(request,dict) and set(request)=={'kind','version','planDigest','components'},'CAPABILITY_REQUEST_SCHEMA')
    require(request['kind']=='ui-decomposition-capability-request' and request['version']=='1.0','CAPABILITY_REQUEST_VERSION')
    token=request['planDigest']
    require(isinstance(token,str) and len(token)==64 and all(c in '0123456789abcdef' for c in token),'CAPABILITY_PLAN_DIGEST')
    require(isinstance(request['components'],list) and bool(request['components']),'CAPABILITY_COMPONENTS_REQUIRED')
    rows=[];seen=set()
    for row in request['components']:
        require(isinstance(row,dict) and set(row)=={'id','type','profiles'},'CAPABILITY_COMPONENT_SCHEMA')
        ident=row['id'];kind=row['type'];profiles=row['profiles']
        require(isinstance(ident,str) and bool(ident.strip()) and ident not in seen,'CAPABILITY_COMPONENT_ID')
        seen.add(ident)
        require(isinstance(kind,str) and isinstance(profiles,list) and bool(profiles) and all(isinstance(p,str) and bool(p) for p in profiles) and len(set(profiles))==len(profiles),'CAPABILITY_PROFILES_REQUIRED')
        for profile in profiles:
            ok=profile in PROFILES.get(kind,set())
            reason='Declared bounded route exists; sample acceptance still required.' if ok else GAPS.get(kind,{}).get(profile,'Unregistered profile; no capability inferred or silently substituted.')
            if profile=='scaled-state-acceptance':reason='Consumer uniform registration exists; generic producer pixel matrix requires sourceCanvas equal to target component.'
            rows.append({'componentId':ident,'componentType':kind,'profile':profile,'supported':ok,'reason':reason})
    result={'kind':'ui-decomposition-capability-report','version':'1.0','planDigest':token,'requestDigest':digest(request),
            'status':'capability_supported' if all(r['supported'] for r in rows) else 'capability_blocked',
            'checks':rows,'coverage':'explicitly_requested_profiles_only','sample_acceptance':False,'human_visual_acceptance':False,'media_calls':0}
    return result


def check_file(source,output):
    require(not output.exists(),'CAPABILITY_OUTPUT_EXISTS')
    result=audit(read_json(source));write_json(output,result);return result
