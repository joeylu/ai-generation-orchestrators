import test from 'node:test';
import assert from 'node:assert/strict';
import {receivedComponentBatch} from '../src/studio/component-batch.mjs';

test('received material-enabled batches proceed only after all five source receipts',()=>{
 const nodes=['S01','S02','S03','S04','S05'].map(sheetId=>({sheetId,status:'received'}));
 assert.equal(receivedComponentBatch({nodes}),true);
 assert.equal(receivedComponentBatch({nodes:nodes.slice(0,4)}),true);
 assert.equal(receivedComponentBatch({nodes:nodes.map(n=>n.sheetId==='S05'?{...n,status:'indeterminate'}:n)}),false);
 assert.equal(receivedComponentBatch({nodes:[...nodes,{sheetId:'S06',status:'received'}]}),false);
 assert.equal(receivedComponentBatch({nodes:nodes.map(n=>({...n,sheetId:'S01'}))}),false);
 assert.equal(receivedComponentBatch({nodes:[]}),false);
 assert.equal(receivedComponentBatch({nodes:nodes.slice(0,4).map(n=>({...n,sheetId:'S01'}))}),false);
 assert.equal(receivedComponentBatch({nodes:nodes.slice(0,4).map(n=>n.sheetId==='S04'?{...n,sheetId:'S05'}:n)}),false);
});
