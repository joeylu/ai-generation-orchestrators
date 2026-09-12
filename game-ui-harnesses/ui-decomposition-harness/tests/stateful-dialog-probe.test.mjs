import assert from 'node:assert/strict';
import {outsideDialogPoint} from '../src/ai_ui_decomposition/stateful-dialog-browser.mjs';
const d={x:310,y:40,width:924,height:850},canvas={width:1536,height:1024};
assert.deepEqual(outsideDialogPoint({x:1078,y:24,width:45,height:46},d,canvas),[1100.5,32]);
assert.equal(outsideDialogPoint({x:400,y:100,width:45,height:46},d,canvas),undefined);
assert.equal(outsideDialogPoint({x:-20,y:10,width:10,height:20},d,canvas),undefined);
assert.deepEqual(outsideDialogPoint({x:-10,y:10,width:20,height:20},d,canvas),[5,20]);
console.log('Dialog external probe: partial overlap, fully covered and canvas clipping passed');
