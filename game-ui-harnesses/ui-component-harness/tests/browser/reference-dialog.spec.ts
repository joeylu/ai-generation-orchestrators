import {test,expect} from '@playwright/test';
import {referenceV2Fixture} from '../helpers/reference-v2-fixture.ts';
import {importComponentHandoffWithReview} from '../../src/component-handoff.ts';
import {createBundle} from '../../src/bundle.ts';

test('Dialog observed open is comparable and actual closed state still mismatches',async({page})=>{
 const {referenceEvidence}=await importComponentHandoffWithReview((await referenceV2Fixture()).zip);
 const style={backgroundColor:'#FFFFFF',borderColor:'#000000',borderWidth:1,cornerRadius:0,textColor:'#000000',fontFamily:'Arial',fontSize:16,fontWeight:'normal',opacity:1};
 const bundle=await createBundle({schemaVersion:'0.2',id:'dialog-reference',canvas:{width:500,height:400},root:{id:'dialog',type:'Dialog',layout:{x:20,y:20,width:450,height:350},props:{style,open:true,modal:true,title:'Fixture'},children:[]}},[],{kind:'programmatic-fixture',description:'Offline Dialog reference-state inspection regression.'});
 await page.goto('/workbench.html');await page.waitForFunction(()=>Boolean(window.uiHarness));await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
 const result=await page.evaluate(async e=>{
  const {compareReference}=await import('/src/reference-visual.ts');
  e.state.components=[{componentId:'dialog',componentType:'Dialog',fields:{open:{status:'observed',value:true,evidence:'Local fixture'}}}];
  e.scope.components=[{componentId:'dialog',mode:'compare',reason:'Fixture'}];e.unknownFields=[];
  const rendered=document.querySelector('#canvas-host canvas');
  const canvas=document.createElement('canvas');canvas.width=500;canvas.height=400;canvas.getContext('2d').drawImage(rendered,0,0);
  const openValue=window.uiHarness.inspect().nodes[0].value;
  const open=await compareReference(e,window.uiHarness.inspect(),canvas);
  window.uiHarness.setValue('dialog',false);
  const closedValue=window.uiHarness.inspect().nodes[0].value;
  const closed=await compareReference(e,window.uiHarness.inspect(),canvas);
  return {openValue,closedValue,open,closed};
 },referenceEvidence);
 expect(result.openValue).toBe(true);expect(result.closedValue).toBe(false);
 expect(result.open.reason).not.toBe('RUNTIME_REFERENCE_STATE_MISMATCH');
 expect(result.closed.reason).toBe('RUNTIME_REFERENCE_STATE_MISMATCH');expect(result.closed.mismatchedFields).toEqual(['dialog.open']);
});
