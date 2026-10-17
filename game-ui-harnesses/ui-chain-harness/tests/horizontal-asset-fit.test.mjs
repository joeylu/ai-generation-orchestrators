import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitAsset,fitHorizontalAsset,supportsSliceFit} from '../src/skins/assemble.mjs';
import {deriveMetadata} from '../src/skins/metadata-draft.mjs';

test('short horizontal artwork fills a wide rail without letterbox gaps or stretched caps',()=>{
  const source={width:40,height:8,pixels:Buffer.alloc(40*8*4)};
  for(let y=0;y<8;y++)for(let x=0;x<40;x++)source.pixels.set(x<4?[255,0,0,255]:x>=36?[0,0,255,255]:[0,255,0,255],(y*40+x)*4);
  assert.equal(fitAsset(source,80,4).image.pixels[3],0); // Original failure.
  for(const width of [16,80]){
    const {image,operation}=fitHorizontalAsset(source,width,4,[4,4]);
    assert.deepEqual(operation.targetCaps,[2,2]);
    for(let y=0;y<4;y++)for(let x=0;x<width;x++){
      const at=(y*width+x)*4;
      assert.deepEqual([...image.pixels.subarray(at,at+4)],x<2?[255,0,0,255]:x>=width-2?[0,0,255,255]:[0,255,0,255]);
    }
  }
  assert.throws(()=>fitHorizontalAsset(source,8,8,[4,4]),/too short/);
  assert.throws(()=>fitHorizontalAsset(source,80,8,[20,20]),/Invalid/);
  assert.equal(supportsSliceFit({method:'horizontal-slice'},'vertical',null),false);
  assert.equal(supportsSliceFit({method:'horizontal-slice'},'horizontal',{}),false);
});

test('generic horizontal metadata binds source end caps and delivered nine-slice units',()=>{
  const id='bar.track',template={coordinates:{outputScale:1},sheets:[{parts:[{assetId:id,stretch:'horizontal',bodyRect:[0,0,768,48]}]}],stateGroups:[]};
  const images=new Map([[id,{width:400,height:40,pixels:Buffer.alloc(400*40*4,255)}]]);
  const policy={version:'1.0',defaultDensity:4,verticalLogicalWidth:10,contentInsets:{},roundedEndHypotheses:[id],automaticAcceptance:false};
  const r=deriveMetadata(template,images,policy);
  assert.deepEqual(r.parts[id].fit,{method:'horizontal-slice',caps:[20,20]});
  assert.deepEqual(r.parts[id].metadata.nineSlice,{left:6,top:0,right:6,bottom:0});
  assert.deepEqual(r.evidence[0].fit.targetCaps,[24,24]);
  assert.equal(r.evidence[0].requiresVisualReview,true);
  const legacy=deriveMetadata(template,images,{...policy,roundedEndHypotheses:[]},{[id]:{nineSlice:{left:6,top:0,right:6,bottom:0}}});
  assert.equal(legacy.parts[id].fit,undefined); // Decorative bars retain the existing fitting path.
});
