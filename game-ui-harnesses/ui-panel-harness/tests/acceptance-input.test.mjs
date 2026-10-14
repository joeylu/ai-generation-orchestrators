import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceInputValue} from '../scripts/lib/acceptance-input.mjs';
test('browser acceptance satisfies feedback minimum and single-character nickname limits',()=>{
  for(const [required,minLength,maxLength,length]of [[true,5,200,5],[true,0,1,1],[false,0,64,2],[true,512,512,512]]){
    const value=acceptanceInputValue({validation:{required,minLength}},{type:'string',maxLength});
    assert.equal(value.length,length);assert(value.trim().length>=minLength);assert(value.length<=maxLength);
  }
  assert.throws(()=>acceptanceInputValue({validation:{required:true,minLength:5}},{type:'string',maxLength:4}),/ACCEPTANCE_INPUT_CONTRACT/);
});
