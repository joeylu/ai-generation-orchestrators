import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal} from '../src/generation/common.mjs';
import {createCoherentSurfaceCalibration,calibratedCoherentTarget,coherentTerrainLayout} from '../src/coherent-layout.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
const target=()=>seal({mapping:{viewport:{width:256,height:144}},instances:[{instanceId:'ground',role:'ground'}],surfaces:[{surfaceId:'s',instanceId:'ground',points:[{x:0,y:80},{x:60,y:80},{x:64,y:100},{x:160,y:100}],evidence:'observed'}]});
const input=()=>({calibrationId:'authored.r1',maximumDeviationWorld:20,surfaces:[{surfaceId:'s',points:[{x:0,y:80},{x:48,y:80},{x:80,y:100},{x:160,y:100}]}],notes:'Synthetic explicit author curve calibration; original steep observation retained.'});
test('explicit calibration retains original observations, endpoints, empty domain and curve constraints',()=>{
 const t=target(),bytes=JSON.stringify(t);assert.throws(()=>coherentTerrainLayout(t));
 const c=createCoherentSurfaceCalibration(t,input()),layout=coherentTerrainLayout(t,'terrain.primary',c);
 assert.equal(JSON.stringify(t),bytes);assert.deepEqual(layout.report.sources[0].observedPoints,t.surfaces[0].points);
 assert.deepEqual(layout.report.sources[0].authoredPoints,c.surfaces[0].points);assert.equal(layout.curveTerrains[0].points.at(-1).x,160);
 assert.equal(layout.report.surfaceCalibrationSha256,c.sha256);assert.equal(calibratedCoherentTarget(t,null),t);
});
test('calibration cannot widen a bank, delete observations, transfer target or silently exceed error and point budgets',()=>{
 const t=target();for(const mutate of [i=>i.surfaces[0].points[0].x=1,i=>i.surfaces=[],i=>i.surfaces[0].points[1].x=5,i=>i.maximumDeviationWorld=33,i=>i.maximumDeviationWorld=1]){
  const i=input();mutate(i);assert.throws(()=>createCoherentSurfaceCalibration(t,i));
 }
 const c=createCoherentSurfaceCalibration(t,input());assert.throws(()=>calibratedCoherentTarget(seal({...unseal(t),differentObservation:true}),c));
});
test('explicit fractional calibration compiles inward integer endpoints without rewriting scaled observations',()=>{
 const t=seal({...unseal(target()),surfaces:[{surfaceId:'s',instanceId:'ground',points:[{x:0.2,y:80.4},{x:60.6,y:80.4},{x:64.8,y:100.2},{x:160.7,y:100.2}],evidence:'observed'}]}),before=JSON.stringify(t);
 const i={...input(),endpointPolicy:'inward-integer-world-v1',surfaces:[{surfaceId:'s',points:[{x:1,y:80},{x:48,y:80},{x:80,y:100},{x:160,y:100}]}]};
 const c=createCoherentSurfaceCalibration(t,i),layout=coherentTerrainLayout(t,'terrain.primary',c);
 assert.equal(c.format,'ai_scene_coherent_surface_calibration_v2');assert.equal(JSON.stringify(t),before);
 assert.deepEqual(layout.report.sources[0].observedPoints,t.surfaces[0].points);
 assert.deepEqual(layout.report.sources[0].authoredPoints,i.surfaces[0].points);
 assert.doesNotThrow(()=>compileCurveGeometry(layout.curveTerrains[0]));
 for(const mutate of [j=>delete j.endpointPolicy,j=>j.endpointPolicy='round-outward',j=>j.surfaces[0].points[0].x=0,j=>j.surfaces[0].points.at(-1).x=161,j=>j.surfaces[0].points[0].y=81,j=>j.maximumDeviationWorld=.1]){
  const changed=structuredClone(i);mutate(changed);assert.throws(()=>createCoherentSurfaceCalibration(t,changed));
 }
 assert.throws(()=>calibratedCoherentTarget(t,seal({...unseal(c),endpointPolicy:'round-outward'})));
});
