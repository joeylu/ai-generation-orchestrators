import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestContentInsets} from '../src/skins/content-insets.mjs';
const policy={version:'1.0',assetPrefixes:['field.'],horizontalClearance:12,minimumHorizontalInset:16,automaticAcceptance:false};
const args={assetId:'field.normal',width:384,resolution:4,configured:{left:8,right:8,top:5,bottom:7},policy,suggestion:{status:'supported',method:'framed-texture-v2',evidence:{bounds:{left:12,right:363},edges:{left:12,right:16}}}};
test('includes transparent margin and physical border at texture density, keeps vertical padding',()=>{
  const r=suggestContentInsets(args);assert.deepEqual(r.proposed,{left:18,right:21,top:5,bottom:7});assert.deepEqual(r.belowRecommended,['left','right']);
  const scaled=structuredClone(args);scaled.width*=2;scaled.resolution*=2;scaled.suggestion.evidence={bounds:{left:24,right:727},edges:{left:24,right:32}};
  assert.deepEqual(suggestContentInsets(scaled).proposed,r.proposed);
});
test('unsupported artwork is review-only, unrelated controls are untouched',()=>{
  assert.equal(suggestContentInsets({...args,suggestion:{status:'unsupported'}}).status,'needs-review');
  assert.equal(suggestContentInsets({...args,assetId:'radio.ring'}).status,'not-applicable');
});
test('repeated bands use conservative border extent; larger configured insets are not flagged',()=>{
  const r=suggestContentInsets({...args,configured:{left:24,right:24,top:5,bottom:7},suggestion:{status:'supported',method:'repeated-center-bands-v1',bordersPx:{left:16,right:24}}});
  assert.deepEqual(r.proposed,{left:16,right:18,top:5,bottom:7});assert.deepEqual(r.belowRecommended,[]);
});
test('rejects invalid density and unsafe policy',()=>{
  assert.throws(()=>suggestContentInsets({...args,resolution:0}));
  assert.throws(()=>suggestContentInsets({...args,policy:{...policy,horizontalClearance:-1}}));
});
