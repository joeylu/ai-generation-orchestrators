import test from 'node:test';
import assert from 'node:assert/strict';
import {readPropertyInput} from '../src/editor/property-values.mjs';
import {editorData,presetDocument} from '../src/panel/data.mjs';
import {applyOperation} from '../src/panel/operations.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {propsSchema,recipeRef} from '../src/contracts/props.mjs';

test('optional blank overrides are omitted while required, nullable, defaults and invalid nonempty values retain schema semantics',()=>{
 assert.equal(readPropertyInput({type:'integer'},{raw:'',read:()=>null}),undefined);
 assert.equal(readPropertyInput({type:'string',pattern:'^#[0-9A-Fa-f]{6}$'},{raw:'  ',read:()=>''}),undefined);
 assert.equal(readPropertyInput({type:'string'},{raw:'',required:true,read:()=>''}),'');
 assert.equal(readPropertyInput({type:['string','null']},{raw:'',read:()=>null}),null);
 assert.equal(readPropertyInput({type:'number',default:1},{raw:'',read:()=>null}),null);
 assert.equal(readPropertyInput({type:'number'},{raw:'0',read:()=>0}),0);
 assert.equal(readPropertyInput({type:'boolean'},{raw:'on',read:()=>false}),false);
 assert.equal(readPropertyInput({type:'string',pattern:'^#[0-9A-Fa-f]{6}$'},{raw:'red',read:()=>'red'}),'red');
});
test('editing text with untouched optional styles passes; explicit styles can reset by omission without relaxing validation',async()=>{
 const ctx=await editorData(),doc=validateDocument(presetDocument(ctx.presets.presets[0],ctx),ctx),note=doc.nodes.find(n=>n.id==='note'),recipe=ctx.registry.recipes.find(r=>recipeRef(r)===note.recipeRef),schema=propsSchema(ctx.registry,recipe);
 const patch=Object.fromEntries(Object.entries(schema.properties).map(([key,s])=>[key,readPropertyInput(s,{required:schema.required?.includes(key)??false,raw:note.props[key]===undefined?'':String(note.props[key]),read:()=>note.props[key]??(s.type==='integer'?null:'')})]));
 patch.text='新文案';const edited=validateDocument(applyOperation(doc,{type:'update',id:'note',patch:{props:patch}}),ctx),props=edited.nodes.find(n=>n.id==='note').props;
 assert.equal(props.text,'新文案');assert.equal(Object.hasOwn(props,'fontSize'),false);assert.equal(Object.hasOwn(props,'textColor'),false);
 const styled=validateDocument(applyOperation(edited,{type:'update',id:'note',patch:{props:{fontSize:18,textColor:'#123456'}}}),ctx);
 const reset=validateDocument(applyOperation(styled,{type:'update',id:'note',patch:{props:{fontSize:undefined,textColor:undefined}}}),ctx),resetProps=reset.nodes.find(n=>n.id==='note').props;
 assert.equal(Object.hasOwn(resetProps,'fontSize'),false);assert.equal(Object.hasOwn(resetProps,'textColor'),false);assert.equal(resetProps.text,'新文案');
 for(const bad of [{fontSize:null},{fontSize:11},{textColor:''},{textColor:'red'}])assert.throws(()=>validateDocument(applyOperation(edited,{type:'update',id:'note',patch:{props:bad}}),ctx),{code:'panel.props'});
 assert.equal(Object.hasOwn(note.props,'fontSize'),false);
});
