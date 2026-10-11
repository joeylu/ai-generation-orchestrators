import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
const makeSpec = () => {
  const canvas={width:320,height:480};
  return {panelSpecVersion:'fixed-reference-1',id:'fixed-test',title:'Read-only',canvas,
    document:{schemaVersion:'0.2',id:'fixed-test',canvas,root:{id:'root',type:'Container',layout:{x:0,y:0,...canvas},
      props:{drawBackground:false,style:{backgroundColor:'#FFFFFF',borderColor:'#000000',borderWidth:0,cornerRadius:0,textColor:'#000000',fontFamily:'sans-serif',fontSize:18,fontWeight:'normal',opacity:1}},children:[]}},
    provenance:{kind:'programmatic-fixture',description:'Synthetic explicit geometry',assumptions:[]}};
};
test('fixed references recompile exact source, reject extra fields, resources, hidden geometry and runtime overrides', async()=>{
  const core=await loadWorkspaceCore(), spec=makeSpec();
  const bundle=await createPanelBundle(spec,null,core);
  assert.deepEqual(await validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
  const forged=structuredClone(bundle);forged.capabilities.sessionRequired=true;
  await assert.rejects(()=>validatePanelBundle(forged,core),/FIXED_REFERENCE_REPLAY_MISMATCH/);
  const bounds=makeSpec();bounds.document.root.layout.x=1;
  await assert.rejects(()=>createPanelBundle(bounds,null,core),/FIXED_REFERENCE_BOUNDS/);
  const extra=makeSpec();extra.script='no';
  await assert.rejects(()=>createPanelBundle(extra,null,core),/FIXED_REFERENCE_FIELDS/);
  const scene=makeSpec();scene.document.interactionState={};
  await assert.rejects(()=>createPanelBundle(scene,null,core));
  await assert.rejects(()=>createPanelBundle(spec,{},core),/FIXED_REFERENCE_OVERRIDES/);
  await assert.rejects(()=>createPanelBundle(spec,null,core,{}),/FIXED_REFERENCE_OVERRIDES/);
  const late=makeSpec(), pending=createPanelBundle(late,null,core);late.document.root.layout.x=999;
  assert.equal((await pending).spec.document.root.layout.x,0);
});
