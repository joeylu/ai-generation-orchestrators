import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {inventoryPresetDocument,inventoryPresetContext} from '../src/panel/inventory-preset.mjs';
import {textEditDocument,rectangleEditDocument,validateSizeEdit} from '../src/panel/size-edit.mjs';

const data=await editorData(),ctx=inventoryPresetContext({...data,orientation:'portrait'}),base=inventoryPresetDocument(ctx),find=doc=>doc.nodes.find(node=>node.id==='inventory-grid');
test('inventory label and typography edit uses scrollable details and retains data, selection and exact grid topology',()=>{
  const before=structuredClone(base),candidate=textEditDocument(base,{nodeId:'inventory-grid',changes:{'items.0.label':'离线药水样例',fontSize:18,textColor:'#3355AA'}},ctx),node=find(candidate);
  assert.equal(node.props.items[0].label,'离线药水样例');assert.equal(node.props.fontSize,18);assert.equal(node.props.textColor,'#3355AA');
  const expected=structuredClone(find(base).props);expected.items[0].label='离线药水样例';expected.fontSize=18;expected.textColor='#3355AA';
  assert.deepEqual(node.props,expected);assert.deepEqual(base,before);assert.equal(candidate.nodes.length,5);
});
test('inventory authoring rejects hidden data mutation and too-small space for the chosen five columns',()=>{
  for(const mutate of [node=>node.props.items[0].quantity++,node=>node.props.items[0].slotIndex=98,node=>node.props.items[0].icon='gem',node=>node.props.selectedId='sample-food',node=>node.props.inventory.gap++]){
    const copy=structuredClone(base);mutate(find(copy));assert.throws(()=>validateSizeEdit(base,copy,ctx));
  }
  assert.throws(()=>rectangleEditDocument(base,{nodeId:'inventory-grid',width:100,height:500},ctx));
  assert.deepEqual(find(base).props.inventory,{columns:5,rows:4,gap:10,details:'below',appearance:'slots'});
});
