"""Concise full-reference prompts for new experimental jobs, not old snapshots."""
import json

TEXT_REMOVAL_LAYOUT = ('Remove glyphs by restoring only the surface beneath them; keep their space empty. '
                       'Do not move, recenter or enlarge neighboring artwork to fill that space. '
                       'An icon beside a deleted label stays at its original offset inside the control. ')

FOREGROUND_FIDELITY = ('Copy the existing artwork, not a polished redesign: do not add glow, shadows, bevels or thicker borders. '
                       'A picture edge is not permission to add a frame; retain only borders visible on this owned artwork. '
                       'Keep all existing soft edges inside the output, with a fully transparent margin on EVERY side, '
                       'including protruding ornaments. Padding must not change artwork proportions. ')

LOCAL_LAYOUT = ('withinMaterial gives centerX, centerY, width and height as fractions of the complete '
                'material bounds, before output padding. Copy each referenced object at that relative '
                'position and size. Move and uniformly scale the whole material as one rigid group; '
                'placing it on the output canvas does not change its internal layout. ')

OWNERSHIP_SCOPE = ('Reference boxes locate artwork; they do not assign every enclosed pixel. '
                   'Retain only the named owner, not the surrounding assembled control. '
                   'Foreign artwork exclusions override generic decoration preservation. ')


def object_content(visual, material):
    """Keep anchored decoration identity without passing control layout labels."""
    l,t,r,b=material['bboxNorm'];result=[]
    for obj in visual['objects']:
        if obj['materialId']!=material['id']:continue
        box=obj.get('bboxNorm')
        if box is None:
            result.append({'artwork':obj['label']})
            continue
        ll,tt,rr,bb=box
        entry=dict(id=obj['id'],kind=obj.get('kind'),referenceBox=box,
            withinMaterial=dict(zip(('centerX','centerY','width','height'),
                (round(v,6) for v in (((ll+rr)/2-l)/(r-l),((tt+bb)/2-t)/(b-t),
                                     (rr-ll)/(r-l),(bb-tt)/(b-t))))))
        if obj.get('kind')=='decoration':entry['artwork']=obj['label']
        result.append(entry)
    return result


def layout_constraints(visual, material, reference_size):
    """Compile existing plan geometry; never infer missing object anchors."""
    if reference_size is None:return LOCAL_LAYOUT
    l,t,r,b=material['bboxNorm'];width,height=reference_size
    ratio=(r-l)*width/((b-t)*height)
    result=(f'Complete outer artwork width/height = {ratio:.4f}:1, EXCLUDING transparent padding. '
            'Preserve this geometry at a single uniform scale; do not reflow rows or compress their spacing. ')
    return result+LOCAL_LAYOUT


def carries_foreground(visual, material):
    """Conservative carrier hint from existing panel ownership, geometry and order."""
    if material['role']!='foreground' or not any(
            o['materialId']==material['id'] and o.get('kind')=='panel' for o in visual['objects']):
        return False
    l,t,r,b=material['bboxNorm']
    for other in visual['materials']:
        if other['role']!='foreground' or other['id']==material['id']:continue
        if other['zOrder']<=material['zOrder']:continue
        ll,tt,rr,bb=other['bboxNorm']
        if l<(ll+rr)/2<r and t<(tt+bb)/2<b and (rr-ll)*(bb-tt)<(r-l)*(b-t):
            return True
    return False


def exclusions(visual, material):
    """Other foreground ownership in this region; boxes are a filter, not masks."""
    l,t,r,b = material['bboxNorm']
    result=[]
    for other in visual['materials']:
        if other['id']==material['id'] or other['role']=='background':continue
        ll,tt,rr,bb=other['bboxNorm']
        if max(l,ll)>=min(r,rr) or max(t,tt)>=min(b,bb):continue
        result.append({'material':other['label'],'referenceBox':other['bboxNorm'],
                       'excludeArtwork':[o['label'] for o in visual['objects'] if o['materialId']==other['id']]})
    return result


def build(visual, asset_id, reference_size=None):
    material = next(m for m in visual['materials'] if m['id'] == asset_id)
    if visual.get('backgroundMode') not in ('scene-only','preserve-underlay') or visual.get('textPolicy') != 'remove-business-text':
        raise ValueError('EXPLICIT_SCOPE_REQUIRED')
    if 'preserveText' not in material:raise ValueError('EXPLICIT_TEXT_EXCEPTIONS_REQUIRED')
    if is_compact_labeled_icon(visual,material):
        target=dict(referenceBox=material['bboxNorm'])
        return compact_icon_prompt(target,reference_size,material['preserveText'])
    if is_atomic_artwork(visual,material):
        return atomic_prompt(visual,material,reference_size)
    if material['role']=='background':
        details=list(dict.fromkeys(o['label'] for o in visual['objects']
                                   if o['materialId']==asset_id))
        prompt=('Use the full reference image. Reconstruct this full opaque underlay at its original layout: '
                +material['label']+'. Retain these visible details: '
                +json.dumps(details,ensure_ascii=False)+'. ')
        if visual['backgroundMode']=='preserve-underlay':
            excluded=[m['label'] for m in visual['materials'] if m['role']=='foreground']
            prompt+=('Keep the visible underlying UI, icons, navigation, layout and dimming. '
                     'Remove only these separately exported foreground materials: '
                     +json.dumps(excluded,ensure_ascii=False)+'. '
                     'Complete their occluded areas from visible underlay evidence; do not brighten the underlay. ')
        else:
            prompt+='Remove all UI surfaces and controls; reconstruct the scene behind them from visible scene evidence. '
        return (prompt+'Remove ordinary labels and numbers except this exact preserveText list: '
                +json.dumps(material['preserveText'],ensure_ascii=False)+'. '
                'Output a full opaque image at the reference aspect ratio.')
    owned = object_content(visual,material)
    if carries_foreground(visual,material):
        return carrier_prompt(visual,material,owned,reference_size)
    target = json.dumps({'material': material['label'], 'bboxNorm': material['bboxNorm'],
                         'retain': owned}, ensure_ascii=False)
    prompt = ('Use the full reference image. Extract only the following artwork: ' + target + '. '
              'Preserve its owned shape, proportions, internal spacing, colors and observed details; do not redesign. '
              'Remove all lettering and numbers except this exact preserveText list: '
              +json.dumps(material['preserveText'],ensure_ascii=False)+'. '
              'The list overrides text visible in the reference or mentioned in object descriptions. '
              'Retain listed decorative lettering exactly as visible. Do not remove its glyphs. '
              'No program will redraw missing artwork. '+TEXT_REMOVAL_LAYOUT)
    excluded=exclusions(visual,material)
    prompt+=OWNERSHIP_SCOPE+layout_constraints(visual,material,reference_size)+FOREGROUND_FIDELITY
    if any(o.get('kind')=='panel' and o['materialId']==asset_id for o in visual['objects']):
        prompt+='Preserve any observed surface translucency in alpha; do not bake the scene behind it into the panel. '
    if excluded:
        prompt+=('Do not draw artwork owned by these other overlapping materials: '
                 +json.dumps(excluded,ensure_ascii=False)+'. '
                 'Remove their frames, ornaments and backing as well as their central content; do not leave empty placeholders or duplicate outlines. '
                 'Keep only the explicitly retained artwork above; do not borrow the excluded unit\'s backing or end ornaments. ')
    if any(o.get('kind')=='illustration' and o['materialId']==asset_id for o in visual['objects']):
        prompt+=('The crop box is not the illustration silhouette. Keep an interior or frame only when it belongs '
                 'to the illustration; clear unrelated scene outside its actual contour. ')
    return prompt + ('Remove unrelated UI and scene. Keep grouped shapes separate '
                     'with their original gaps and no shared backing. Output a transparent PNG, '
                     'with all contours intact and clear padding outside the artwork.')


def is_atomic_artwork(visual, material):
    """Only a single anchored graphic occupying its entire material needs no layout rules."""
    owned=[o for o in visual['objects'] if o['materialId']==material['id']]
    return (material['role']=='foreground' and not material['preserveText'] and
            len(owned)==1 and owned[0].get('kind') in ('decoration','icon') and
            (owned[0].get('bboxNorm')==material['bboxNorm'] or
             (owned[0].get('kind')=='icon' and owned[0].get('bboxNorm') is None)))


def is_compact_labeled_icon(visual, material):
    """One composite icon with anchored lettering, not a general control layout."""
    if material['role']!='foreground' or not material['preserveText']:
        return False
    owned=[o for o in visual['objects'] if o['materialId']==material['id']]
    icons=[o for o in owned if o['kind']=='icon' and o.get('bboxNorm') is None]
    details=[o for o in owned if o['kind']=='decoration' and o.get('bboxNorm') is not None]
    labels=' '.join(o['label'] for o in details)
    return (len(icons)==1 and len(details)>=1 and len(owned)==1+len(details) and
            all(text in labels for text in material['preserveText']))


def atomic_prompt(visual, material, reference_size):
    target=dict(material=material['label'],referenceBox=material['bboxNorm'])
    owned=[o for o in visual['objects'] if o['materialId']==material['id']]
    if owned[0].get('kind')=='icon' and owned[0].get('bboxNorm') is None:
        return compact_icon_prompt(dict(referenceBox=material['bboxNorm']), reference_size)
    prompt=('Use the full reference image. Isolate only this artwork: '
            +json.dumps(target,ensure_ascii=False)+'. '
            'Keep its complete observed shape, color, texture and existing details. '+OWNERSHIP_SCOPE)
    excluded=[dict(material=e['material'],referenceBox=e['referenceBox'])
              for e in exclusions(visual,material)]
    if excluded:
        prompt+=('Exclude these complete foreign units, including their backing, frames and end ornaments: '
                 +json.dumps(excluded,ensure_ascii=False)+'. Do not output the assembled control; '
                 'do not borrow any of its surrounding edges. ')
    if reference_size is not None:
        from .evaluate import pixel_box
        l,t,r,b=pixel_box(material['bboxNorm'],*reference_size)
        prompt+=(f'Artwork target {r-l}x{b-t} pixels; width/height {(r-l)/(b-t):.4f}:1, '
                 'excluding transparent padding. Scale uniformly; do not widen or shorten to fill the canvas. ')
    prompt+=('Remove lettering and numbers. Do not add outlines, glow, shadows or decoration. '
             'Output one transparent PNG (RGBA), with the complete contour and clear padding on EVERY side. '
             'No other UI or scene.')
    return prompt


def compact_icon_prompt(target, reference_size, preserve_text=None):
    """A locator and an extraction request, without a new design brief."""
    if reference_size is not None:
        from .evaluate import pixel_box
        l,t,r,b=pixel_box(target['referenceBox'],*reference_size)
        locator=f'x={l}..{r}, y={t}..{b} in the {reference_size[0]}x{reference_size[1]} reference'
    else:
        locator='normalized box '+json.dumps(target['referenceBox'])
    prompt=('Extract only the existing icon at '+locator+' from the full reference image. '
            'Remove its surrounding panel and background. Keep the visible icon unchanged. ')
    if preserve_text:
        prompt+=('Keep the decorative text on the icon: '
                 +json.dumps(preserve_text,ensure_ascii=False)+'. Remove other nearby labels. ')
    else:
        prompt+='Remove nearby labels. '
    prompt+='Output only this icon as a transparent PNG.'
    return prompt


def carrier_prompt(visual, material, owned, reference_size):
    """A carrier is one continuous owned surface, never a board of disconnected cutouts."""
    contract={'keepOnly':owned,'removeCompletely':exclusions(visual,material)}
    prompt=('Use the full reference image to produce ONE clean backing-panel asset: '+material['label']+'. '
            'Its reference region is '+json.dumps(material['bboxNorm'])+'. '
            'Artwork ownership (removal takes precedence over generic requests to preserve decoration): '
            +json.dumps(contract,ensure_ascii=False)+'. '
            'Remove each listed foreign asset as a COMPLETE unit, including its picture, frame, leaves, ribbon, '
            'ornaments and backing when present. Do not turn a removed picture into an empty frame or a transparent window. '
            'Reconstruct the panel surface across the entire removed unit, matching the surrounding surface. '
            'These removed regions must remain continuous panel pixels, not transparent holes. '
            'Continuous surface does not mean opaque: preserve observed translucency in alpha, '
            'without baking the scene behind the panel into its texture. '
            'Preserve only this panel\'s owned contours, colors, texture and fixed decorations at their original positions. '
            'Do not shorten the panel or close up the empty space left by removed children. ')
    prompt+=layout_constraints(visual,material,reference_size)+FOREGROUND_FIDELITY
    prompt+=('Remove lettering and numbers except this exact preserveText list: '
             +json.dumps(material['preserveText'],ensure_ascii=False)+'. '
             'This list overrides wording in object descriptions; preserve listed glyphs. '+TEXT_REMOVAL_LAYOUT+
             'Output one transparent PNG: transparency outside the complete panel silhouette, '
             'clear padding beyond every outer contour. Preserve any genuine original openings; '
             'removing a child must never create a new opening. No other UI or scene. No program will redraw missing artwork.')
    return prompt


def compact_carrier_prompt(visual, asset_id, reference_size):
    """Opt-in prompt comparison; does not change the default or archived prompts."""
    material=next(m for m in visual['materials'] if m['id']==asset_id)
    if not carries_foreground(visual,material):raise ValueError('CARRIER_REQUIRED')
    if visual.get('textPolicy')!='remove-business-text' or 'preserveText' not in material:
        raise ValueError('EXPLICIT_SCOPE_REQUIRED')
    l,t,r,b=material['bboxNorm'];width,height=reference_size
    ratio=(r-l)*width/((b-t)*height)
    removed=[entry['material'] for entry in exclusions(visual,material)]
    text=('Remove all lettering and numbers.' if not material['preserveText'] else
          'Remove lettering and numbers except these exact strings: '+json.dumps(material['preserveText'],ensure_ascii=False)+'.')
    return ('From the full reference, isolate this backing panel: '+material['label']+'.\n'
            'Reference region: '+json.dumps(material['bboxNorm'])+'. Preserve its full outer outline and proportions; '
            f'artwork width/height {ratio:.4f}:1, excluding padding. Resize only uniformly; do not crop or compress the panel.\n'
            'Remove these complete assets, including their attached frames and decorations: '
            +json.dumps(removed,ensure_ascii=False)+'. Replace their footprints with continuous matching panel surface, not holes or empty frames.\n'
            'Keep the panel\'s own artwork and fixed decoration in their original relative positions; the removal list takes precedence. '
            +text+' '+TEXT_REMOVAL_LAYOUT+'\n'
            'Output one PNG with real transparency outside the complete panel and clear padding on every side. '
            'Preserve genuine original openings; do not create openings where removed assets were. No other UI or scene.')
