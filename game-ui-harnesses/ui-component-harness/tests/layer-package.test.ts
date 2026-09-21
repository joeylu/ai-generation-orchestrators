import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateComposition } from '../src/layer-package.ts';
const fixture=()=>({kind:'ui_layer_composition_v1',canvas:{width:200,height:100},coordinates:'top-left-pixels',order:'array-back-to-front',textPolicy:'remove-business-text',backgroundMode:'scene-only',reference:'reference.png',preview:'preview.png',layers:[{id:'panel',name:'Panel',role:'foreground',path:'layers/layer-001.png',x:10,y:20,width:100,height:50,visible:true}]});
test('minimal layer contract has no component requirements',()=>{assert.equal(validateComposition(fixture()).layers[0].x,10);});
test('reject paths, out of bounds, duplicate ids and unknown transforms',()=>{
  let c=fixture();c.layers[0].path='../secret.png';assert.throws(()=>validateComposition(c));
  c=fixture();c.layers[0].x=180;assert.throws(()=>validateComposition(c));
  c=fixture();c.layers.push({...c.layers[0]});assert.throws(()=>validateComposition(c));
  c=fixture();Object.assign(c.layers[0],{scale:2});assert.throws(()=>validateComposition(c));
});
