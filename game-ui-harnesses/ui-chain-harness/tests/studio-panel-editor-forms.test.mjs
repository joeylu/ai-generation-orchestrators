import test from 'node:test';
import assert from 'node:assert/strict';
import {panelFormDraft,panelTextInputValue} from '../src/studio/panel-editor-forms.mjs';
const baseline={rect:{width:'235',height:'166'},text:{fields:{text:'开始'},fontDefault:true,fontSize:'18',colorDefault:true,textColor:''}};
test('equivalent numeric and inherited style input does not create a draft',()=>{
 const values=structuredClone(baseline);values.rect.width='235.000';values.text.fontSize='80';values.text.textColor='#FFFFFF';
 assert.deepEqual(panelFormDraft(values,baseline),{});
});
test('invalid dimensions and edited text retain their raw input independently',()=>{
 const values=structuredClone(baseline);values.rect.width='';values.text.fields.text='新名称';values.text.fontDefault=false;values.text.fontSize='';
 const draft=panelFormDraft(values,baseline);assert.deepEqual(draft,values);draft.text.fields.text='别的';assert.equal(values.text.fields.text,'新名称');
});
test('equivalent explicit color keeps no draft; explicit default changes do',()=>{
 const b=structuredClone(baseline);b.text.colorDefault=false;b.text.textColor='#aabbcc';
 const values=structuredClone(b);values.text.textColor='#AABBCC';assert.deepEqual(panelFormDraft(values,b),{});
 values.text.colorDefault=true;assert.deepEqual(panelFormDraft(values,b),{text:values.text});
});
test('a fractional font remains an unapplied invalid value even near the saved integer',()=>{
 const b=structuredClone(baseline);b.text.fontDefault=false;const values=structuredClone(b);values.text.fontSize='18.001';assert.deepEqual(panelFormDraft(values,b),{text:values.text});
});
test('HTML line-ending normalization only affects form equality, not frozen source strings',()=>{
 const original='第一行\r\n第二行\r第三行';assert.equal(panelTextInputValue(original,true),'第一行\n第二行\n第三行');assert.equal(panelTextInputValue(original,false),'第一行第二行第三行');assert.equal(original,'第一行\r\n第二行\r第三行');
 const baseline={text:{fields:{text:panelTextInputValue(original,true)},fontDefault:true,fontSize:'18',colorDefault:true,textColor:''}};
 assert.deepEqual(panelFormDraft(structuredClone(baseline),baseline),{});
});
