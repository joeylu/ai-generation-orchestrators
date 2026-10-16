import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCjkClosingWrap} from '../src/runtime/cjk-text-flow.mjs';
const base={enabled:true,text:'前方传来鸟鸣。',width:216,height:56,fontSize:16,wordWrap:true};
const metrics=(lines,width=200,height=42)=>({lines,width,height});

test('closing orphan uses the first safe width within one em without changing authored text or geometry',()=>{
 const input={...base,measure:w=>w>207?metrics(['前方传来鸟鸣','。']):metrics(['前方传来鸟','鸣。'])},snapshot={...input};
 const result=selectCjkClosingWrap(input);
 assert.equal(result.width,207);assert.equal(result.shrink,9);assert.deepEqual(result.after,['前方传来鸟','鸣。']);assert.equal(input.text,snapshot.text);assert.equal(input.fontSize,snapshot.fontSize);assert.equal(input.width,snapshot.width);
});
test('author newlines, nonwrapped text, English and old scopes remain untouched',()=>{
 for(const patch of[{enabled:false},{wordWrap:false},{text:'前方传来鸟鸣\n。'},{text:'前方传来鸟鸣\r。'},{text:'前方传来鸟鸣\u2028。'},{text:'前方传来鸟鸣\u2029。'},{text:'Hello world.'},{text:'Hello\n。'}]){
  let called=false;const r=selectCjkClosingWrap({...base,...patch,measure:()=>{called=true;throw Error('must not measure');}});
  assert.equal(r.changed,false);assert.equal(called,false);
 }
});
test('two closing characters can balance while ordinary CJK endings do not reflow',()=>{
 const r=selectCjkClosingWrap({...base,text:'前方传来鸟鸣。”',measure:w=>w===216?metrics(['前方传来鸟鸣','。”']):metrics(['前方传来鸟','鸣。”'])});
 assert.equal(r.width,215);
 assert.equal(selectCjkClosingWrap({...base,measure:()=>metrics(['前方传来','鸟鸣。'])}).changed,false);
});
test('a balance that increases line count, exceeds the box or needs over one em is refused',()=>{
 for(const measure of[
 w=>w===216?metrics(['前方传来鸟鸣','。']):metrics(['前方传来','鸟','鸣。']),
 w=>w===216?metrics(['前方传来鸟鸣','。']):metrics(['前方传来鸟','鸣。'],200,56.1),
 w=>w>199?metrics(['前方传来鸟鸣','。']):metrics(['前方传来鸟','鸣。']),
 w=>w===216?metrics(['前方传来鸟鸣','。']):metrics(['前方传来鸟','鸣。'],216.1,42),
 ])assert.equal(selectCjkClosingWrap({...base,measure}).changed,false);
});
