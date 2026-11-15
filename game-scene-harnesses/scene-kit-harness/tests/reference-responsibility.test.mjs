import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,hash} from '../src/generation/common.mjs';
import {createLayerSourceScopes} from '../src/generation/layer-source.mjs';
import {checkReferenceObservationCoverage,assertReferenceObservationCoverage} from '../src/generation/reference-observation-coverage.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {dockRaster,dockColors,dockParts} from './helpers/reference-responsibility.mjs';

test('industrial interleaving cannot be restored by sorting a single merged machine sprite',()=>{
  const intended=dockRaster(),behind=dockRaster(['warehouse','rear','front','hook','cargo','deck']),
    ahead=dockRaster(['warehouse','hook','cargo','rear','front','deck']);
  const pixel=(r,x,y)=>[...r.rgba.subarray((y*2*r.width+x*2)*4,(y*2*r.width+x*2)*4+4)];
  // Cargo covers the rear crossbar but is covered by the near column.
  // A merged rear + front sprite placed behind/in front loses one relation.
  assert.deepEqual(pixel(intended,175,80),dockColors.cargo);
  assert.deepEqual(pixel(intended,208,80),dockColors.front);
  assert.notDeepEqual(pixel(behind,208,80),pixel(intended,208,80));
  assert.deepEqual(pixel(intended,175,104),dockColors.cargo);
  assert.notDeepEqual(pixel(ahead,175,104),pixel(intended,175,104));
  // The top opening shows a different owner, not a solid machine backdrop.
  assert.deepEqual(pixel(intended,140,60),dockColors.sky);
});

test('independent dock parts and hidden assumptions survive source freeze and replay without compute',t=>{
  const raw=dockRaster().png;
  const f=setupCoherent(t,'Industrial loading dock',undefined,{
    referenceBytes:raw,
    transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),
      layers:[...b.requirements.layers.filter(l=>['sky','landmark','ground'].includes(l.layerId)),...dockParts.map((p,i)=>({layerId:'machine.'+p.id,kind:'environment',zIndex:11+i,parallaxX:.6}))].sort((a,b)=>a.zIndex-b.zIndex),
      subjects:[...b.requirements.subjects.filter(s=>['sky','landmark','ground'].includes(s.subjectId)).map(s=>({...s,content:{sky:'Pale industrial sky',landmark:'Warehouse roof and fixed walls',ground:'Metal deck material'}[s.subjectId]})),...dockParts.map(p=>({subjectId:'machine.'+p.id,role:'scenery',layerId:'machine.'+p.id,content:p.content,count:{min:1,max:1},placementHint:'center'}))]})}),
    transformAnalysis:a=>seal({...unseal(a),surfaces:[{...a.surfaces[0],points:[{x:0,y:121},{x:256,y:121}]}],instances:[
      ...a.instances.filter(i=>['sky','landmark','ground'].includes(i.subjectId)).map(i=>{
        const box=i.subjectId==='landmark'?[12,28,67,77]:i.subjectId==='ground'?[0,121,256,23]:[0,0,256,144];
        const [x,y,w,h]=box;return {...i,visibleEnvelope:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],anchor:{x:x+w/2,y:y+h/2}};
      }),...dockParts.map(p=>{
      const [x,y,w,h]=p.box;return {instanceId:p.id+'.actual',subjectId:'machine.'+p.id,layerId:'machine.'+p.id,
        visibleEnvelope:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],anchor:{x:x+w/2,y:y+h/2},
        visibility:'visible',anchorEvidence:'observed',notes:'Synthetic coarse region; hidden continuations are not measured.'};})]})
  });
  const sourceScopes=createLayerSourceScopes(f.brief.requirements,dockParts.map(p=>({subjectId:'machine.'+p.id,
    content:p.content,exclusions:p.exclusions,parentRole:'middle',groundingProfile:'scope-owned-support-v1'})));
  const observations=dockParts.map(p=>({observationId:p.id,description:p.content,layerId:'machine.'+p.id,parentRole:'middle'}));
  const assignments=dockParts.map(p=>({observationId:p.id,subjectId:'machine.'+p.id,scopeQuote:p.content.split(';')[0].split('.')[0]}));
  const input={referenceBytes:raw,requirements:f.brief.requirements,sourceScopes,requiredObservationIds:dockParts.map(p=>p.id),observations,assignments};
  const report=checkReferenceObservationCoverage(input);assert.equal(report.status,'pass');
  const omitted=checkReferenceObservationCoverage({...input,assignments:assignments.filter(p=>p.observationId!=='hook')});
  assert.equal(omitted.status,'fail');assert(omitted.findings.some(p=>p.observationId==='hook'));
  const misowned=checkReferenceObservationCoverage({...input,assignments:assignments.map(p=>p.observationId==='front'?{...p,subjectId:'machine.rear'}:p)});
  assert.equal(misowned.status,'fail');
  const before=flow.inspectWorkflow(f.workflow),options={...f.options,sourceScopes};
  const preview=flow.previewCoherentSources(f.workflow,options);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const batch=flow.freezeCoherentSources(f.workflow,options);
  for(const part of dockParts){
    const planned=preview.plans.find(p=>p.recipe.assetId===part.id+'.actual');assert(planned);
    assert(batch.planSha256s.includes(planned.sha256));
    const replay=flow.getGenerationPlan(f.workflow,planned.sha256);
    assert.deepEqual(replay,planned);
    assert.deepEqual(replay.recipe.sourceScope.subjectIds,['machine.'+part.id]);
    assert.equal(replay.recipe.sourceScope.content,part.content);
    assert(replay.request.prompt.includes(part.content));
    for(const excluded of part.exclusions)assert(replay.recipe.sourceScope.exclusions.includes(excluded));
    assert.equal(replay.request.images[0].artifact.sha256,hash(raw));
    assert.equal(replay.sourceScope.semanticIsolationProven,false);
    assert.throws(()=>flow.reservePlan(f.workflow,replay.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
  }
  const changed=createLayerSourceScopes(f.brief.requirements,dockParts.map(p=>({subjectId:'machine.'+p.id,content:p.content+(p.id==='hook'?' Changed hidden tip design.':''),exclusions:p.exclusions,parentRole:'middle',groundingProfile:'scope-owned-support-v1'})));
  assert.throws(()=>assertReferenceObservationCoverage({...input,sourceScopes:changed},report));
  const revised=flow.previewCoherentSources(f.workflow,{...options,sourceScopes:changed});
  assert.notEqual(revised.plans.find(p=>p.recipe.assetId==='hook.actual').sha256,preview.plans.find(p=>p.recipe.assetId==='hook.actual').sha256);
  assert(flow.inspectWorkflow(f.workflow).plans.filter(p=>p.stage==='coherent-source').every(p=>!p.reserved&&!p.received));
});
