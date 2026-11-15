import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal} from '../src/generation/common.mjs';
import {createCoherentComposition,coherentCompositionContacts,validateCoherentComposition} from '../src/coherent-composition.mjs';
import {coherentSurfacePoints,coherentSurfaceY,coherentTerrainLayout,suggestCoherentContacts,coherentContactPlacement,validateCoherentContacts} from '../src/coherent-layout.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';

const rect=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
const batch={sha256:'b'.repeat(64)};
function targetFor(theme='autumn'){
  return {sha256:'a'.repeat(64),mapping:{viewport:{width:1024,height:576}},layers:[{layerId:'back'},{layerId:'ground'}],instances:[
    {instanceId:'ground.left',role:'ground',visibleEnvelope:rect(0,300,345,276)},
    {instanceId:'ground.right',role:'ground',visibleEnvelope:rect(831,300,193,276)},
    {instanceId:theme+'.tree',role:'scenery',visibleEnvelope:rect(103,156,179,150)},
    {instanceId:theme+'.building',role:'landmark',visibleEnvelope:rect(540,173,416,255)},
    {instanceId:'platform',role:'platform',visibleEnvelope:rect(418,350,211,91)},
  ],surfaces:[
    {surfaceId:'left.top',instanceId:'ground.left',points:[{x:0,y:314},{x:110,y:312},{x:230,y:315},{x:327,y:320}]},
    {surfaceId:'right.top',instanceId:'ground.right',points:[{x:844,y:324},{x:920,y:314},{x:1023,y:308}]},
    {surfaceId:'platform.top',instanceId:'platform',points:[{x:423,y:360},{x:525,y:357},{x:623,y:362}]},
  ]};
}

test('reviewed surfaces preserve their horizontal span and observations rather than grid expansion',()=>{
  for(const theme of ['autumn','desert']){
    const target=targetFor(theme),before=structuredClone(target),{curveTerrains,report}=coherentTerrainLayout(target);
    assert.equal(curveTerrains.length,2);
    assert.equal(curveTerrains[0].points.at(-1).x,327);assert.equal(curveTerrains[1].points[0].x,844);
    assert.equal(report.sources[0].avoidedGridExpansion.right,57);assert.equal(report.sources[1].avoidedGridExpansion.left,12);
    for(const curve of curveTerrains){
      assert.equal(curve.baseY,576);assert.equal(curve.points[0].slope,0);assert.equal(curve.points.at(-1).slope,0);
      const geometry=compileCurveGeometry(curve);
      const original=target.surfaces.find(surface=>surface.surfaceId===report.sources.find(row=>row.curveId===curve.curveId).surfaceId);
      assert.deepEqual(curve.points.map(({x,y})=>({x,y})),original.points);
      for(const point of curve.points)assert.ok(geometry.samples.some(sample=>sample.x===point.x&&sample.y===point.y));
    }
    assert.equal(report.unseenOutlineReconstructed,false);assert.equal(report.generationCalls,0);assert.deepEqual(target,before);
  }
});

test('curve surfaces limit intermediate slopes and reject unsupported observation density without silently dropping points',()=>{
  const surface={points:[{x:0,y:100},{x:64,y:108},{x:128,y:112},{x:192,y:100}]},points=coherentSurfacePoints(surface);
  assert.equal(points[1].slope,.0625);assert.equal(points[2].slope,0);
  for(let x=0;x<=192;x++)assert.ok(coherentSurfaceY(surface,x)>=100&&coherentSurfaceY(surface,x)<=112);
  assert.throws(()=>coherentSurfacePoints({points:[{x:0,y:100},{x:16,y:101},{x:100,y:100}]}));
  assert.throws(()=>coherentSurfaceY(surface,193));
  const target=targetFor();target.surfaces[0].points[0].y=570;assert.throws(()=>coherentTerrainLayout(target));
});

test('contact suggestions use a disclosed bottom-center proximity convention and keep distant foundations independent',()=>{
  const target=targetFor(),contacts=suggestCoherentContacts(target);
  assert.deepEqual(contacts,[{instanceId:'autumn.tree',surfaceId:'left.top',atX:192.5,sourceAnchor:'content-bottom-center'}]);
  const {position,evidence}=coherentContactPlacement(contacts[0],target,{width:179,height:133});
  assert.equal(position.x,103);assert.equal(position.y+133,coherentSurfaceY(target.surfaces[0],192.5));
  assert.equal(evidence.worldContact.x,192.5);assert.equal(evidence.semanticAnchorDetected,false);assert.equal(evidence.sourcePngModified,false);
  assert.equal(evidence.visualAcceptance,'not-assessed');
  const distant=structuredClone(target);distant.instances[2].visibleEnvelope=rect(103,80,179,150);
  assert.deepEqual(suggestCoherentContacts(distant),[]);
});

test('v3 compositions bind joined material and observed geometry while retaining density and explicit overrides',()=>{
  const target=targetFor(),profile=createCoherentComposition(batch,target);
  assert.equal(profile.format,'ai_scene_coherent_composition_v3');assert.equal(profile.sourceSampling,'display-density-2x-v1');
  assert.equal(profile.terrainGeometry,'reviewed-surface-curves-v1');assert.equal(profile.terrainMaterial,'joined-surface-field-v1');
  assert.equal(validateCoherentComposition(profile,batch,target).size,0);assert.equal(coherentCompositionContacts(profile).size,1);
  const transform={instanceId:'autumn.tree',x:100,y:100,scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1};
  const override=createCoherentComposition(batch,target,{transforms:[transform],layerOrder:['ground','back']});
  assert.equal(override.contacts.length,0);assert.deepEqual(override.transforms,[transform]);
  assert.deepEqual(createCoherentComposition(batch,target,{contacts:[]}).contacts,[]);
  assert.throws(()=>createCoherentComposition(batch,target,{arbitrary:'pixel-repair'}));
});

test('contacts reject stale/ambiguous position, unsupported semantic anchors and non-ground attachment',()=>{
  const target=targetFor(),profile=createCoherentComposition(batch,target),body=unseal(profile),contact=profile.contacts[0];
  const reject=change=>assert.throws(()=>validateCoherentComposition(seal({...body,...change}),batch,target));
  reject({targetSha256:'c'.repeat(64)});reject({terrainMaterial:'unreviewed'});reject({terrainGeometry:'arbitrary'});
  reject({contacts:[contact,contact]});reject({contacts:[{...contact,sourceAnchor:'detected-root'}]});
  reject({contacts:[{...contact,surfaceId:'platform.top',atX:525}]});reject({contacts:[{...contact,atX:328}]});
  reject({contacts:[{...contact,instanceId:'platform'}]});reject({contacts:[{...contact,opacity:0}]});
  reject({transforms:[{instanceId:contact.instanceId,x:0,y:0,scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1}]});
  assert.throws(()=>validateCoherentContacts([contact],target,new Map([[contact.instanceId,{}]])));
  assert.throws(()=>coherentContactPlacement(contact,target,{width:0,height:100}));
});
