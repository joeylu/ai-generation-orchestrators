import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveMetadata} from '../src/skins/metadata-draft.mjs';
const policy={version:'1.0',defaultDensity:4,verticalLogicalWidth:10,densityOverrides:{},contentInsets:{},roundedEndHypotheses:[],automaticAcceptance:false};
const image=(w,h)=>({width:w,height:h,pixels:Buffer.alloc(w*h*4)});
const template=(id,stretch,w,h)=>({coordinates:{outputScale:1},sheets:[{parts:[{assetId:id,stretch,bodyRect:[0,0,w,h]}]}],stateGroups:[]});
test('unrecognized rectangular texture stops rather than inventing slices; explicit override is audited',()=>{
  const t=template('field.normal','nine-slice',96,48),images=new Map([['field.normal',image(96,48)]]);
  assert.throws(()=>deriveMetadata(t,images,policy),/override-required/);
  const r=deriveMetadata(t,images,policy,{'field.normal':{nineSlice:{left:3,right:3,top:3,bottom:3}}});
  assert.equal(r.evidence[0].cutsBasis,'skin-override');
  assert.equal(r.evidence[0].requiresVisualReview,true);
});
test('vertical width drives density; rounded caps require explicit allowlist and do not distort cap scale',()=>{
  const t=template('scrollbar.track','vertical',48,512),images=new Map([['scrollbar.track',image(60,400)]]);
  assert.throws(()=>deriveMetadata(t,images,policy),/caps-override-required/);
  const r=deriveMetadata(t,images,{...policy,roundedEndHypotheses:['scrollbar.track']});
  assert.equal(r.parts['scrollbar.track'].metadata.density,4.8);
  assert.deepEqual(r.parts['scrollbar.track'].fit.caps,[30,30]);
  assert.deepEqual(r.evidence[0].fit.targetCaps,[24,24]);
  assert.equal(r.evidence[0].capBasis,'rounded-half-source-width-hypothesis');
});
test('invalid or oversized caps and unknown exception IDs are rejected',()=>{
  const t=template('rail','vertical',32,160),images=new Map([['rail',image(30,80)]]);
  assert.throws(()=>deriveMetadata(t,images,policy,{rail:{caps:[40,40]}}));
  assert.throws(()=>deriveMetadata(t,images,policy,{typo:{density:4}}),/unknown-asset/);
  assert.throws(()=>deriveMetadata(t,images,policy,{rail:{density:0,caps:[10,10]}}),/invalid-density/);
});
test('uniform artwork never receives guessed nine-slice cuts',()=>{
  const t=template('dot','uniform',48,48),images=new Map([['dot',image(40,40)]]);
  const r=deriveMetadata(t,images,policy);
  assert.deepEqual(r.parts.dot.metadata.nineSlice,{left:0,top:0,right:0,bottom:0});
  assert.throws(()=>deriveMetadata(t,images,policy,{dot:{nineSlice:{left:1,top:1,right:1,bottom:1}}}));
});
test('horizontal toolbar caps preserve source-end scale without requiring a two-axis repeatable center',()=>{
  const t=template('surface.bar','horizontal',512,64),source=image(900,100);
  for(let y=0;y<100;y++)for(let x=0;x<900;x++){const p=(y*900+x)*4;source.pixels[p]=x%251;source.pixels[p+1]=y*2;source.pixels[p+3]=255;}
  const r=deriveMetadata(t,new Map([['surface.bar',source]]),{...policy,roundedEndHypotheses:['surface.bar']});
  assert.deepEqual(r.parts['surface.bar'].fit.caps,[50,50]);
  assert.deepEqual(r.evidence[0].fit.targetCaps,[32,32]);
  assert.equal(r.parts['surface.bar'].metadata.nineSlice.top,0);
  assert.equal(r.evidence[0].requiresVisualReview,true);
});
test('state-family tabs derive only horizontal cuts from framed textures with vertical padding',()=>{
  const source=image(320,96);
  for(let y=24;y<72;y++)for(let x=4;x<316;x++)source.pixels.set(x<16||x>=304||y<34||y>=62?[60,35,15,255]:[180+(x*7+y*11)%7,140,80,255],(y*320+x)*4);
  const t=template('tab.normal','horizontal',320,96);
  t.sheets[0].parts.push({...t.sheets[0].parts[0],assetId:'tab.selected'});t.stateGroups=[{assetIds:['tab.normal','tab.selected']}];
  const r=deriveMetadata(t,new Map([['tab.normal',source],['tab.selected',source]]),policy);
  for(const p of Object.values(r.parts)){
    assert.ok(p.metadata.nineSlice.left>0&&p.metadata.nineSlice.right>0);
    assert.equal(p.metadata.nineSlice.top,0);assert.equal(p.metadata.nineSlice.bottom,0);
  }
  assert.equal(r.evidence[0].cutsBasis,'panel-slicer-horizontal-ends');
});
