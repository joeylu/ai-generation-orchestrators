import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoherentComposition,createMeasuredCoherentComposition,validateCoherentComposition,coherentCompositionContacts} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {referencePng,sourcePng} from './helpers/coherent.mjs';

const rect=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
function fixture(){
  const batch={sha256:'b'.repeat(64)},reference=referencePng(),material=sourcePng(false,17);
  const target=seal({format:'ai_scene_reference_reconstruction_target_v2',rawSha256:hash(reference),
    mapping:{nativeSize:{width:512,height:288},viewport:{width:256,height:144},scale:{numerator:1,denominator:2}},
    layers:[{layerId:'sky'},{layerId:'ground'},{layerId:'middle'}],
    instances:[{instanceId:'sky.actual',role:'sky',visibleEnvelope:rect(0,0,256,144)},
      {instanceId:'ground.actual',role:'ground',visibleEnvelope:rect(0,95,70,49)},
      {instanceId:'tree.actual',role:'scenery',visibleEnvelope:rect(5,40,35,50)}],
    surfaces:[{surfaceId:'ground.surface',instanceId:'ground.actual',points:[{x:0,y:95},{x:70,y:95}]}]});
  const observations={format:'ai_scene_measured_surface_observations_v1',sourceSurfaceTopY:40,sourceBodyStartY:100,sourceWindowCenterX:512,
    rockFeaturePairs:[{featureId:'macro.rock',source:{fromX:100,toX:140},reference:{fromX:80,toX:140}}],
    referenceSurfaceSamples:[{sampleId:'surface.depth',surfaceId:'ground.surface',x:10,topY:190,bodyStartY:214}],
    notes:'Synthetic manually observed spans, not segmentation or an art acceptance.'};
  return {batch,target,mapping:compileMeasuredSurfaceMapping({reference,target,material,observations})};
}

test('measured compositions bind an immutable surface mapping and retain rational depth with normal v3 contact rules',()=>{
  const {batch,target,mapping}=fixture(),before=structuredClone(mapping),profile=createMeasuredCoherentComposition(batch,target,mapping);
  assert.equal(profile.format,'ai_scene_coherent_composition_v4');assert.equal(profile.terrainMaterial,'measured-surface-field-v1');
  assert.equal(profile.terrainGeometry,'reviewed-surface-curves-v1');assert.equal(profile.sourceSampling,'display-density-2x-v1');
  assert.equal(profile.surfaceMapping.sha256,mapping.sha256);assert.deepEqual(profile.surfaceMapping.capDepth,mapping.capDepth);
  assert(mapping.capDepth.denominator>1,'the mapping retains fractional depth rather than rounding to a fixed strip');
  assert.equal(validateCoherentComposition(profile,batch,target).size,0);assert.equal(coherentCompositionContacts(profile).size,1);
  assert.deepEqual(profile.contacts,[{instanceId:'tree.actual',surfaceId:'ground.surface',atX:22.5,sourceAnchor:'content-bottom-center'}]);
  assert.deepEqual(mapping,before);assert.equal(mapping.visualAcceptance,'not-assessed');assert.equal(mapping.generationCalls,0);
});

test('measured compositions reject changed target, reference identity, source parameters and resealed mapping context',()=>{
  const {batch,target,mapping}=fixture(),profile=createMeasuredCoherentComposition(batch,target,mapping),body=unseal(profile);
  const reject=change=>assert.throws(()=>validateCoherentComposition(seal({...body,...change}),batch,target));
  reject({targetSha256:'f'.repeat(64)});reject({terrainMaterial:'joined-surface-field-v1'});reject({terrainGeometry:'arbitrary'});
  reject({surfaceMapping:seal({...unseal(mapping),targetSha256:'f'.repeat(64)})});
  reject({surfaceMapping:seal({...unseal(mapping),reference:{...mapping.reference,sha256:'f'.repeat(64)}})});
  reject({surfaceMapping:seal({...unseal(mapping),reference:{...mapping.reference,pixelSize:{width:1024,height:288}}})});
  reject({surfaceMapping:seal({...unseal(mapping),targetMapping:{...mapping.targetMapping,viewport:{width:257,height:144}}})});
  reject({surfaceMapping:seal({...unseal(mapping),observations:{...mapping.observations,
    referenceSurfaceSamples:mapping.observations.referenceSurfaceSamples.map(sample=>({...sample,surfaceId:'absent.surface'}))}})});
  reject({surfaceMapping:seal({...unseal(mapping),capDepth:{numerator:32,denominator:1}})});
  reject({surfaceMapping:{...mapping,sha256:'f'.repeat(64)}});reject({surfaceMapping:null});
  reject({surfaceMapping:{...mapping,alphaCleanup:true}});
  assert.throws(()=>createMeasuredCoherentComposition(batch,{...target,rawSha256:'f'.repeat(64)},mapping));
});

test('measured author options preserve layer order, explicit placement overrides and single contact ownership',()=>{
  const {batch,target,mapping}=fixture(),transform={instanceId:'tree.actual',x:10,y:30,scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1};
  const profile=createMeasuredCoherentComposition(batch,target,mapping,{transforms:[transform],layerOrder:['sky','middle','ground']});
  assert.deepEqual(profile.transforms,[transform]);assert.deepEqual(profile.contacts,[]);assert.deepEqual(profile.layerOrder,['sky','middle','ground']);
  const contact={instanceId:'tree.actual',surfaceId:'ground.surface',atX:22.5,sourceAnchor:'content-bottom-center'};
  assert.throws(()=>createMeasuredCoherentComposition(batch,target,mapping,{transforms:[transform],contacts:[contact]}));
  assert.throws(()=>createMeasuredCoherentComposition(batch,target,mapping,{contacts:[contact,contact]}));
  assert.throws(()=>createMeasuredCoherentComposition(batch,target,mapping,{contacts:[{...contact,sourceAnchor:'semantic-root'}]}));
  assert.throws(()=>createMeasuredCoherentComposition(batch,target,mapping,{alphaCleanup:true}));
});

test('the existing constructor keeps v3 defaults and older composition shapes do not gain measured fields',()=>{
  const {batch,target,mapping}=fixture(),v3=createCoherentComposition(batch,target),before=JSON.stringify(v3);
  createMeasuredCoherentComposition(batch,target,mapping);
  assert.equal(JSON.stringify(createCoherentComposition(batch,target)),before);assert.equal(v3.format,'ai_scene_coherent_composition_v3');
  assert.equal(v3.terrainMaterial,'joined-surface-field-v1');assert.equal(Object.hasOwn(v3,'surfaceMapping'),false);
  const v2=seal({format:'ai_scene_coherent_composition_v2',batchSha256:batch.sha256,targetSha256:target.sha256,sourceSampling:'display-density-2x-v1',transforms:[]});
  assert.equal(validateCoherentComposition(v2,batch,target).size,0);assert.equal(coherentCompositionContacts(v2).size,0);
  const {sha256:unused,...v2body}=v2;assert.throws(()=>validateCoherentComposition(seal({...v2body,surfaceMapping:mapping}),batch,target));
  assert.throws(()=>validateCoherentComposition(seal({...unseal(v3),surfaceMapping:mapping}),batch,target));
});
