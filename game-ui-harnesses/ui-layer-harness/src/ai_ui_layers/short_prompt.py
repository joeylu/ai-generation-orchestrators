"""Concise full-reference prompts for new experimental jobs, not old snapshots."""
import json

TEXT_REMOVAL_LAYOUT = ('Remove glyphs by restoring only the surface beneath them; keep their space empty. '
                       'Do not move, recenter or enlarge neighboring artwork to fill that space. ')


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
        result.append({'material':other['label'],
                       'excludeArtwork':[o['label'] for o in visual['objects'] if o['materialId']==other['id']]})
    return result


def build(visual, asset_id, reference_size=None):
    material = next(m for m in visual['materials'] if m['id'] == asset_id)
    if visual.get('backgroundMode') not in ('scene-only','preserve-underlay') or visual.get('textPolicy') != 'remove-business-text':
        raise ValueError('EXPLICIT_SCOPE_REQUIRED')
    if 'preserveText' not in material:raise ValueError('EXPLICIT_TEXT_EXCEPTIONS_REQUIRED')
    owned = [o['label'] for o in visual['objects'] if o['materialId'] == asset_id]
    if carries_foreground(visual,material):
        return carrier_prompt(visual,material,owned,reference_size)
    target = json.dumps({'material': material['label'], 'bboxNorm': material['bboxNorm'],
                         'retain': owned}, ensure_ascii=False)
    prompt = ('Use the full reference image. Extract only the following artwork: ' + target + '. '
              'Preserve its shape, proportions, internal spacing, colors and integrated decorations, '
              'including fixed dividers and graphic symbols; do not redesign. '
              'Remove all lettering and numbers except this exact preserveText list: '
              +json.dumps(material['preserveText'],ensure_ascii=False)+'. '
              'The list overrides text visible in the reference or mentioned in object descriptions. '
              'Retain listed decorative lettering exactly as visible. Do not remove its glyphs. '
              'No program will redraw missing artwork. '+TEXT_REMOVAL_LAYOUT)
    if material['role'] == 'background':
        if visual['backgroundMode']=='preserve-underlay':
            excluded=[m['label'] for m in visual['materials'] if m['role']=='foreground']
            prompt+=('Keep the visible underlying UI surfaces, icons, navigation, layout and dimming. '
                     'Remove only these separately exported foreground materials: '+json.dumps(excluded,ensure_ascii=False)+'. '
                     'Complete their occluded areas from visible underlay evidence; do not replace the underlay with a bare scene or brighten it. ')
        else:prompt+='Remove all UI surfaces and controls; reconstruct the scene behind them from visible scene evidence. '
        return prompt+'Output a full opaque image at the reference aspect ratio.'
    excluded=exclusions(visual,material)
    if excluded:
        prompt+=('Do not draw artwork owned by these other overlapping materials: '
                 +json.dumps(excluded,ensure_ascii=False)+'. '
                 'Remove their frames, ornaments and backing as well as their central content; do not leave empty placeholders or duplicate outlines. '
                 'Continue only this material\'s own surface behind them. Keep the explicitly retained artwork above. ')
    if any(o.get('kind')=='illustration' and o['materialId']==asset_id for o in visual['objects']):
        prompt+=('Retain the COMPLETE picture, including its internal scene/background and any owned frame, '
                 'at the original relative scale. Do not cut out the person or objects inside the picture. '
                 'The picture interior must remain filled; transparency belongs outside the whole asset. ')
    return prompt + ('Remove unrelated UI and scene. Restore owned surfaces behind removed content. Keep grouped shapes separate '
                     'with their original gaps and no shared backing. Output a transparent PNG, '
                     'with all contours intact and clear padding outside the artwork.')


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
            'Preserve only this panel\'s owned contours, colors, texture and fixed decorations at their original positions. '
            'Do not shorten the panel or close up the empty space left by removed children. ')
    if reference_size is not None:
        l,t,r,b=material['bboxNorm'];ratio=(r-l)*reference_size[0]/((b-t)*reference_size[1])
        prompt+=f'Complete outer artwork width/height = {ratio:.4f}:1, EXCLUDING transparent padding. '
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
