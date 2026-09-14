import {test,expect} from '@playwright/test';
import {referenceV2Fixture} from '../helpers/reference-v2-fixture.ts';
import {importComponentHandoffWithReview} from '../../src/component-handoff.ts';
test('partial comparison isolates local uncertainty and never hides known failures',async({page})=>{
 const {referenceEvidence}=await importComponentHandoffWithReview((await referenceV2Fixture()).zip);
 await page.goto('/reference-acceptance.html');
 const results=await page.evaluate(async e=>{
  const {compareReference,mappedReference}=await import('/src/reference-visual.ts');
  e.state.components=[{componentId:'meter',fields:{value:{status:'unknown',reason:'fixture'}}}];e.unknownFields=['meter.value'];e.visualComparisonReady=false;
  e.scope.components=[{componentId:'known',mode:'compare'},{componentId:'meter',mode:'compare'}];
  const nodes=[{id:'known',type:'Image',visible:true,bounds:{x:0,y:0,width:500,height:400}},{id:'meter',type:'ProgressBar',visible:true,bounds:{x:10,y:10,width:10,height:10}}];
  // Known paint is spatially disjoint from the uncertain meter.
  nodes[0].bounds={x:100,y:100,width:100,height:100};
  const inspection={nodes,paintRegions:nodes.map(n=>({componentId:n.id,bounds:n.bounds}))};
  const canvas=await mappedReference(e);const partial=await compareReference(e,inspection,canvas);
  canvas.getContext('2d').fillStyle='#ff00ff';canvas.getContext('2d').fillRect(100,100,100,100);const failure=await compareReference(e,inspection,canvas);
  nodes[1].type='ScrollView';const global=await compareReference(e,inspection,canvas);
  nodes[1].type='ProgressBar';nodes[1].bounds={x:100,y:100,width:100,height:100};const overlap=await compareReference(e,inspection,canvas);
  return {partial,failure,global,overlap};
 },referenceEvidence);
 expect(results.partial.status).toBe('partially_verified');expect(results.partial.counts).toEqual({passed:1,failed:0,unverified:1});
 expect(results.failure.status).toBe('failed');expect(results.failure.coverage).toBe('partial');
 expect(results.global.status).toBe('blocked');expect(results.overlap.status).toBe('blocked');
});

test('occluded compare scopes count as unverified and cannot report complete coverage',async({page})=>{
 const {referenceEvidence}=await importComponentHandoffWithReview((await referenceV2Fixture()).zip);
 await page.goto('/reference-acceptance.html');
 const result=await page.evaluate(async e=>{
  const {compareReference,mappedReference}=await import('/src/reference-visual.ts');
  e.state.components=[];e.unknownFields=[];e.scope.components=[{componentId:'visible',mode:'compare'},{componentId:'occluded',mode:'compare'}];
  const bounds={x:0,y:0,width:500,height:400};
  const nodes=['visible','occluded'].map(id=>({id,type:'Image',visible:true,bounds}));
  return compareReference(e,{nodes,paintRegions:[{componentId:'visible',bounds}]},await mappedReference(e));
 },referenceEvidence);
 expect(result.coverage).toBe('partial');expect(result.counts).toEqual({passed:1,failed:0,unverified:1});
 expect(result.scopes.find(s=>s.componentId==='occluded').reason).toBe('NO_VISIBLE_OWN_RECTANGLE');
 expect(result.status).toBe('partially_verified');
});
