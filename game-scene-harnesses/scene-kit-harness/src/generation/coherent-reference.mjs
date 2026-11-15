import {compileReferenceLedPlan} from './reference-led.mjs';
import {renderControlGuides,controlGuideRecipe} from '../reference-controls.mjs';
import {check,imageRef,seal,unseal} from './common.mjs';
export function coherentReferenceGuides(){const files=renderControlGuides();return ['projection-guide.png','focus-guide.png'].map(path=>({path,bytes:files.get(path)}));}
export function compileCoherentReference(state,recipe){
  const {parents}=recipe;check(Array.isArray(parents)&&parents.length<=1,'PLAN_PARENT');
  if(parents.length){const p=state.plans.get(parents[0]);check(p?.plan.format==='ai_scene_generation_plan_v28'
    &&['failed','indeterminate','rejected-technical','rejected-visual'].includes(p.status),'PLAN_PARENT');}
  const base=unseal(compileReferenceLedPlan(state,{...recipe,parents:[]})),cap=state.capabilities.get(recipe.capabilitiesSha256);
  const guides=coherentReferenceGuides();check(cap?.imageToImage&&base.request.images.length+2<=cap.maxInputImages,'COHERENT_REFERENCE_CAPABILITY');
  const prompt=[
    'INPUT ROLE OVERRIDE: the first TWO images are neutral TECHNICAL EXAMPLES, not artwork, style references or a level layout. Image 1 demonstrates a flat front-elevation stepped profile with no receding walkable top plane. Image 2 demonstrates crisp foreground contours without camera blur. Ignore their grayscale palette, white strips, sample shape and counts; white strips mean a generic edge marking, NOT literal snow. Never add snow, rock, castle or vegetation unless the scene content asks for it.',
    'Any remaining images are STYLE ONLY as declared below. Keep the chosen written style (including pixel art or flat color), and use material/colors from the requested biome. The technical examples never prescribe the scene coordinates.',
    base.request.prompt,
    'OVERALL-COHERENCE DELIVERY: preserve theme, style, depth, major groups and readable side-view gameplay. Subsequent assets are isolated subject redraws fitted into coarse observed envelopes. Pixel-exact matching and per-branch material probes are not requirements. The complete reference and coarse actual layout still receive separate human review.'
  ].join('\n\n');
  return seal({...base,format:'ai_scene_generation_plan_v28',compiler:'scene-kit-coherent-reference-v1',recipe,
    neutralGuideEvidence:{recipeSha256:controlGuideRecipe.sha256,meaning:'projection-and-focus-only-no-theme-or-layout',effect:'requires-actual-image-review'},
    request:{...base.request,format:'ai_scene_image_request_v28',prompt,images:[
      ...guides.map((g,index)=>({role:index?'neutral-crisp-foreground-example':'neutral-front-elevation-example',artifact:imageRef(g.bytes)})),...base.request.images]}});
}
