import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreAssetBatch } from '../src/core-asset-profile.mjs';
import { createAssetRetrieval } from '../src/asset-retrieval.mjs';

const sources=[['play','icon.play','47f17635587635a44cc213d4'],['pause','icon.pause','126709bd7121380bde5ec315'],['settings','icon.settings','b2b14cf1ba03336bb4be0b03'],['back','icon.arrow-simple-left','a0a536d4792364606fa82bc1'],['home','icon.home','bbe2caa6e3e257cc5c348205'],['volume','icon.speaker','ad2392a3924b99c50f8c88cb'],['music','icon.music','51279d9e850196e5e0f814d9'],['mute','audio.mute',null],['user','icon.user','f1dcfbb8a91bcc3ca9171131'],['confirm','icon.check','26b9a563df457bd04723f990'],['close','icon.close','1384615d72ad6f91258df733'],['reset','icon.refresh','485aecab3531403fab964013']];
const index=()=>({records:sources.map(([id,family,key])=>({key:key?`modern-mint/texture-${key}@0.1.0`:'game-ui/mute@1.0.0',metadata:{role:'icon',family,variant:key?'default':'outline',slice:null,size:{width:64,height:64}},source:{format:'svg',file:{sha256:'a'.repeat(64)}},file:{sha256:'b'.repeat(64)}}))});
test('core profile has stable descriptive identities and leaves the verified source untouched',()=>{
  const source=index(),before=structuredClone(source),p=createCoreAssetBatch(source);
  assert.deepEqual(source,before);assert.equal(p.batch.assets.length,12);
  assert.deepEqual(p.batch.assets.map(a=>a.id),sources.map(s=>s[0]));
  assert(p.batch.assets.every(a=>a.role==='icon'&&a.style==='modern-core'&&a.slice===null));
});
test('core profile rejects missing, substituted role, family and filled variants',()=>{
  for(const mutate of [i=>i.records.pop(),i=>i.records[0].metadata.role='shape',i=>i.records[0].metadata.family='icon.pause',i=>i.records[0].metadata.variant='filled',i=>i.records[0].metadata.slice={left:1,right:1,top:1,bottom:1}]){
    const i=index();mutate(i);assert.throws(()=>createCoreAssetBatch(i),/CORE_ASSET_SOURCE_MISMATCH/);
  }
});
test('plain-language resume, restore defaults and character naming retrieve exact core icons without surfaces',()=>{
  const p=createCoreAssetBatch(index()),library={assetLibraryVersion:'0.1',id:'panel-core-assets',sha256:'c'.repeat(64),records:p.batch.assets.map(a=>({key:`panel-core/${a.id}@1.0.0`,namespace:'panel-core',metadata:Object.fromEntries(Object.entries(a).filter(([k])=>k!=='file')),file:{sha256:'b'.repeat(64),bytes:100}}))};
  for(const [q,ids]of [['暂停菜单，继续游戏、设置、返回主菜单',['play','settings','back','home']],['声音设置，主音量、音乐音量、静音、恢复默认',['volume','music','mute','reset']],['角色命名，角色名、确认、取消',['user','confirm','close']]]){
    const retrieval=createAssetRetrieval(q,library);assert(retrieval.candidates.every(c=>c.slot==='row-icon'));
    for(const id of ids)assert(retrieval.candidates.some(c=>c.asset.key===`panel-core/${id}@1.0.0`),id);
  }
});
