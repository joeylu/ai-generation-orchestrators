import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelEditorTree} from '../src/studio/panel-editor-tree.mjs';
function fixture(){
 const container={children:[],scrollTop:73,ownerDocument:{createElement(){return {dataset:{},style:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},scrollIntoView(){this.scrolls=(this.scrolls??0)+1;},remove(){container.children.splice(container.children.indexOf(this),1);}};}},insertBefore(button,before){const old=this.children.indexOf(button);if(old>=0)this.children.splice(old,1);this.children.splice(before?this.children.indexOf(before):this.children.length,0,button);this.mutations++;},mutations:0};
 const chosen=[],tree=createPanelEditorTree(container,id=>chosen.push(id));return {container,tree,chosen};
}
const items=[{id:'panel',label:'面板整体',depth:0},{id:'body',label:'内容布局',depth:1},{id:'button',label:'开始',depth:2}];
test('updates preserve button identity, order, focus target and layer scroll',()=>{
 const {container,tree,chosen}=fixture();tree.update(items,'body');const focused=tree.button('body'),mutations=container.mutations;
 tree.update(items,'body',{pending:new Set(['body'])});assert.equal(tree.button('body'),focused);assert.equal(container.mutations,mutations);assert.equal(container.scrollTop,73);assert.equal(focused.scrolls,1);assert.equal(focused.dataset.draft,'true');focused.onclick();assert.deepEqual(chosen,['body']);
 tree.update(items,'button');assert.equal(tree.button('button').scrolls,1);assert.equal(focused.scrolls,1);
});
test('structural updates reuse surviving buttons and remove obsolete layers',()=>{
 const {container,tree}=fixture();tree.update(items,'body');const button=tree.button('button');
 tree.update([items[0],items[2]],'button',{disabled:true});assert.equal(tree.button('body'),undefined);assert.equal(tree.button('button'),button);assert.equal(button.disabled,true);assert.deepEqual(container.children.map(b=>b.dataset.node),['panel','button']);
});
