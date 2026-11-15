import {check,contract,clone} from './common.mjs';
import {BACKGROUND_BAND_GUIDE_PROFILE} from './background-band-guide.mjs';

export const BACKGROUND_BAND_PROFILE='background-band-v1';
export const GUIDED_BACKGROUND_BAND_PROFILE='background-band-guided-v2';
export const COVERAGE_BACKGROUND_BAND_PROFILE='background-band-coverage-v3';
export const OPEN_DEPTH_BACKGROUND_BAND_PROFILE='background-band-open-depth-v4';
export const BACKGROUND_BAND_FINITE_CUTS_PROFILE='natural-top-finite-three-cuts-v1';
export function backgroundBandCoverage(band){
  const {camera:c,parallax:p}=band,d=c.centerDomainWorld,o=c.referenceCenterWorld,v=c.viewportWorld;
  const modes=c.modes.map(mode=>{const px=mode==='editor-unparallax'?1:p.x,py=mode==='editor-unparallax'?1:p.y;
    return {mode,left:o.x+px*(d.minX-o.x)-v.width/2,right:o.x+px*(d.maxX-o.x)+v.width/2,
      top:o.y+py*(d.minY-o.y)-v.height/2,bottom:o.y+py*(d.maxY-o.y)+v.height/2};});
  return {modes,union:{left:Math.min(...modes.map(m=>m.left)),right:Math.max(...modes.map(m=>m.right)),
    top:Math.min(...modes.map(m=>m.top)),bottom:Math.max(...modes.map(m=>m.bottom))},
    usage:'finite-declared-camera-domain-only-no-unbounded-pan-zoom-or-repeat',contentContinuity:'not-assessed'};
}
export function validateBackgroundBand(band,{role,layerId,requirements,viewport}={}){
  contract(band);check((band.format==='ai_scene_background_band_v1'&&band.profile===BACKGROUND_BAND_PROFILE
    ||band.format==='ai_scene_background_band_v2'&&band.profile===GUIDED_BACKGROUND_BAND_PROFILE&&band.guidanceProfile===BACKGROUND_BAND_GUIDE_PROFILE
    ||band.format==='ai_scene_background_band_v3'&&band.profile===COVERAGE_BACKGROUND_BAND_PROFILE
      &&band.guidanceProfile==='normalized-three-cut-coverage-v1'&&band.boundaryProfile===BACKGROUND_BAND_FINITE_CUTS_PROFILE
    ||band.format==='ai_scene_background_band_v4'&&band.profile===OPEN_DEPTH_BACKGROUND_BAND_PROFILE
      &&['open-depth-three-cut-coverage-v1','open-trench-three-cut-coverage-v2','open-valley-irregular-coverage-v3'].includes(band.guidanceProfile)&&band.boundaryProfile===BACKGROUND_BAND_FINITE_CUTS_PROFILE)
    &&['backdrop','valley'].includes(role),'BACKGROUND_BAND_ROLE');
  check(band.guidanceProfile!=='open-trench-three-cut-coverage-v2'||role==='valley','BACKGROUND_BAND_OPEN_TRENCH_ROLE');
  check(band.guidanceProfile!=='open-valley-irregular-coverage-v3'||role==='valley','BACKGROUND_BAND_IRREGULAR_VALLEY_ROLE');
  const c=band.camera,d=c.centerDomainWorld,o=c.referenceCenterWorld,f=band.coverageFrameWorld;
  check(o.x===c.viewportWorld.width/2&&o.y===c.viewportWorld.height/2,'BACKGROUND_BAND_CAMERA_BINDING');
  check(d.minX<=o.x&&o.x<=d.maxX&&d.minY<=o.y&&o.y<=d.maxY,'BACKGROUND_BAND_CAMERA_DOMAIN');
  check(band.canvasAspect.numerator/band.canvasAspect.denominator>=1&&band.canvasAspect.numerator/band.canvasAspect.denominator<=8,'BACKGROUND_BAND_ASPECT');
  if(requirements){const layer=requirements.layers.find(l=>l.layerId===layerId);
    check(layer&&layer.parallaxX===band.parallax.x,'BACKGROUND_BAND_PARALLAX');}
  if(viewport)check(c.viewportWorld.width===viewport.width&&c.viewportWorld.height===viewport.height
    &&o.x===viewport.width/2&&o.y===viewport.height/2,'BACKGROUND_BAND_CAMERA_BINDING');
  const coverage=backgroundBandCoverage(band),u=coverage.union;
  check(f.x<u.left&&f.x+f.width>u.right&&f.y+f.height>u.bottom,'BACKGROUND_BAND_FRAME_COVERAGE');
  return clone(band);
}
export function backgroundBandPrompt(band){
  if(band.format==='ai_scene_background_band_v4'&&band.guidanceProfile==='open-valley-irregular-coverage-v3')return [
    `BACKGROUND BAND ${OPEN_DEPTH_BACKGROUND_BAND_PROFILE}, explicit open-valley-irregular-coverage-v3: use the ${band.canvasAspect.numerator}:${band.canvasAspect.denominator} asset-local aspect of the transparent technical example in Image 2.`,
    'Paint only the brief-owned same-depth material and its allowed structures. The neutral example distinguishes irregular same-layer forms from genuine transparent voids; it does not provide subject identity, scene layout, material, style, color or exact geometry. Never infer a platform, bridge, tower or freestanding column from it.',
    'Same-depth local material and its own irregular contours may continue across finite side and bottom cuts where present; true voids crossing a cut stay transparent. Keep at least two transparent native rows along the top. Actual brief-owned structures may cross or locally occlude gaps; their existence and extent are owned by the brief, not the guide.',
    'No sky, fog sheet or other neighboring layer fills real openings. The relative feature budget is a soft scale cue, not a fixed number of forms or copied contour. Image 1 supplies original material, color, lighting and brushwork. Preserve every original RGBA value; content identity, finite camera coverage, actual scale and final art still require independent review.'
  ].join('\n\n');
  if(band.format==='ai_scene_background_band_v4'&&band.guidanceProfile==='open-trench-three-cut-coverage-v2')return [
    `BACKGROUND BAND ${OPEN_DEPTH_BACKGROUND_BAND_PROFILE}, explicit open-trench-three-cut-coverage-v2: use the ${band.canvasAspect.numerator}:${band.canvasAspect.denominator} asset-local aspect of the transparent technical example in Image 2.`,
    'OPEN TRENCH TOPOLOGY: build broad side-connected eroded material masses that step down toward a genuine open trench. The dominant forms are wide supported bodies and irregular shoulders, not detached narrow uprights, a tall-post forest or a row of enclosed arch holes. A central empty-space route continues from above through the middle to the lower finite cut. Its route is qualitative topology, never exact scene coordinates, a fixed subject count or a copied contour.',
    'The highest portions may enter the upper 4–12 percent of the canvas; lower shoulders can begin farther down. Major material features around 22–32 percent of canvas width are only a SOFT frequency cue. Do not make every secondary fragment a quarter-width feature, trace the example steps or turn its rough two-side construction into the whole playable scene.',
    'Image 2 has true zero-Alpha open space, broad neutral stepped side bodies and no enclosed hole or thin freestanding post. It teaches broad body-versus-open-trench topology, not architecture, stone, a subject identity, exact number of groups, colors, palette, brushwork, illumination or pixel silhouettes. The single-source brief decides which attached local fragments belong to this same layer; this example never requests a complete colonnade, bridge, independent landmark, playable ledge or near-camera group.',
    'Leave the trench, upper surround and genuine gaps truly transparent. Do not fill them with sky, water, surface ripples, light rays, fog sheet, background color or an opaque technical surround. Keep the outer TOP at least TWO native pixels genuinely transparent. LEFT, RIGHT and BOTTOM are finite cuts: material crossing a cut continues its own material; empty space crossing a cut stays empty. Do not add a common enclosing upper wave, bottom slab, island foot or fade to connect the forms.',
    'Image 1 remains the complete accepted reference for original local material colors, brushwork, reflected light and atmospheric hierarchy. Image 2 supplies only the explicit asset topology, aspect and soft feature scale. Preserve every native RGBA value and the original PNG; never carve or repair holes, crop a bad contour, erase background or recolor after generation. Unseen continuation is design inference, and finite full-native placement, camera coverage, usable scale and source art still require independent review.'
  ].join('\n\n');
  if(band.format==='ai_scene_background_band_v4')return [
    `BACKGROUND BAND ${OPEN_DEPTH_BACKGROUND_BAND_PROFILE}: use canvas aspect ${band.canvasAspect.numerator}:${band.canvasAspect.denominator}, matching the real transparent open-depth example in Image 2.`,
    'Paint only the requested same-depth material forms, with genuine transparent empty spaces BETWEEN and THROUGH them. The highest parts of the forms may enter the upper 4–12 percent of the canvas, while lower forms may begin farther down. Broad major form widths around 22–32 percent of the canvas are a SOFT feature-frequency cue, never a number of objects or a copied outline.',
    'OPEN BODY: there is no shared solid lower body or enclosing top wave. Open space can run from the top through the middle all the way to the bottom and through a side cut. It belongs to another depth layer, so leave it truly transparent instead of filling it with sky, water, reflected surface ripples, light rays, a blue wash, fog sheet or an opaque neutral surround.',
    'The natural TOP of each painted form keeps real transparency above and around it, and the outer TOP border requires at least TWO native pixels of real transparency. LEFT, RIGHT and BOTTOM remain finite off-camera CUTS: a painted form crossing one of those cuts continues its own material to that edge; a true void crossing a cut stays transparent. Neither every column nor every cut pixel must be painted. Do not add a shared base, closing foot, top band, bottom slab, fade or patch of background color to connect separate forms.',
    'Image 2 is a fixed abstract technical raster with actual zero-Alpha voids, detached same-layer masses and real holes. Learn the material-versus-empty-space relationship, asset aspect and soft feature scale. Do not copy its gray color, flat style, exact geometry, object count, holes, scene layout or subject identity. Image 1 and the single-source brief own original colors, material, brushwork, light and atmospheric depth.',
    'Preserve the native PNG and every original RGBA value. Never remove filled background, carve openings, crop away a painted border, recolor or edit Alpha after generation. Unseen same-layer continuation is a disclosed design inference. Actual dimensions, original feature scale, full-native-frame placement, finite camera-domain coverage, real openings and art require independent measurement and visual review; this is not infinite tiling or automatic semantic success.'
  ].join('\n\n');
  if(band.format==='ai_scene_background_band_v3')return [
    `BACKGROUND BAND ${COVERAGE_BACKGROUND_BAND_PROFILE}: use canvas aspect ${band.canvasAspect.numerator}:${band.canvasAspect.denominator}, matching Image 2; do not substitute an ultrawide 3:1 strip when a different aspect is declared.`,
    'Use the normalized asset-local coverage budget: place the natural upper contour about 4–12 percent down from the canvas top. Keep adjacent major landform widths around 22–32 percent of canvas width as a SOFT feature-frequency guide, not an exact peak count, copied outline or pixel target. The same-layer painted body occupies the remaining height continuously to the bottom.',
    'The natural TOP remains transparent above its silhouette, with a genuine transparent top border at least TWO native pixels high. LEFT, RIGHT and BOTTOM are declared finite off-camera CUTS: paint the same layer ALL THE WAY TO those three native canvas edges. They need no transparent gutter, rounded closing foot, feathered halo or centered-island margin. Preserve real openings and every original RGBA value; never erase Alpha, pad or recolor after generation.',
    'Image 2 MUST guide this aspect and normalized coverage budget. Its neutral display sky is not an opaque output background. Do not copy its exact outline, crest count, gray values, flat style, subject identity or scene layout. Image 1 and the single-layer brief determine original colors, material, brushwork, lighting and atmospheric depth.',
    'The full native frame is calibrated only after reception. Native dimensions are not guaranteed: report actual pixels per world unit separately from the 2px/world target. No old author coordinates, exact scene placement, camera coordinates, automatic tiling or unbounded coverage are generation targets. Unseen same-layer continuation is disclosed new painting, not hidden-pixel recovery; range checks never grant painted continuity or art acceptance.'
  ].join('\n\n');
  if(band.format==='ai_scene_background_band_v2')return [
    `BACKGROUND BAND profile ${GUIDED_BACKGROUND_BAND_PROFILE}. Paint ONE continuous same-depth landscape band on a wide asset-local canvas, approximately ${band.canvasAspect.numerator}:${band.canvasAspect.denominator}.`,
    'Keep the natural transparent upper skyline in the upper portion of the asset canvas, with genuine transparent sky and real openings above it. Preserve the reference-relative feature scale and atmospheric depth; do not enlarge the main peaks or turn a far layer into a near-camera wall.',
    'Paint NEW SAME-LAYER content across the broad lower canvas ALL THE WAY TO its finite lower technical cut. Both lateral sides also continue the same layer up to their inner technical edges. The painted lower body must not curl upward into a closed mountain foot, floating island, scalloped lower silhouette, or surrounding feathered halo with empty canvas beneath it.',
    'Reserve only a SMALL transparent technical frame, approximately two percent of this asset canvas and at least TWO native pixels on each border. It is technical display clearance, not twelve-percent natural empty margins. The source must contain actual lower and lateral painting; transparent padding alone is not continuation.',
    'Image 2 is only a neutral asset-local coverage example. Do not copy its gray display surround, opaque background, exact outline, crest count, subject identity or flat style. Image 1 and the single-layer brief determine the original colors, brushwork, light, material, atmospheric hierarchy and subject identity.',
    'The three finite ends are intended to lie outside the separately reviewed camera domain. No camera coordinates or old author layout are output targets. Do not paint neighboring layers, host ground or an occluder. Unseen same-layer continuation is a disclosed new design inference. No tiling, repeated loop, infinite coverage or automatic art acceptance is claimed.'
  ].join('\n\n');
  return [
    `BACKGROUND BAND profile ${BACKGROUND_BAND_PROFILE}. Paint ONE continuous same-depth landscape band on a wide asset-local canvas, approximately ${band.canvasAspect.numerator}:${band.canvasAspect.denominator}.`,
    'The TOP is a natural transparent skyline or landform silhouette; open sky above it remains genuine transparency. The LEFT and RIGHT continue the SAME layer laterally, and the BOTTOM continues its own lower depth painting into the declared off-camera coverage reserve. Do not taper these three edges inward or close them into a centered island.',
    'The left, right and lower terminations are finite asset ends intended to be placed outside a separately reviewed finite camera domain. Do not paint an occluding layer, host terrain, sky or neighboring depth group. No automatic repetition, tiling, seamless-loop claim or infinite camera coverage is requested.',
    'Keep a genuine fully transparent technical gutter at least TWO native pixels wide on all four image borders. This technical gutter is not a request for 12 percent natural empty margins or a closed island. Within that gutter the side and lower artwork may end as a same-layer continuation; preserve all real upper contours and transparent openings.',
    'Camera coordinates, parallax numbers and old scene placement are review metadata only. The program will require independent full-native-frame calibration after reception; generated coverage and content continuity are not automatically certified.'
  ].join('\n\n');
}
