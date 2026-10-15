import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTextReadability,sampleSurface,textReadabilityPolicy as policy} from '../src/skins/text-readability.mjs';
const image=(color,size=64)=>({width:size,height:size,pixels:Buffer.from(Array.from({length:size*size},(_,i)=>typeof color==='function'?color(i%size,Math.floor(i/size)):color).flat())});
const asset=id=>({assetId:id,sha256:'a'.repeat(64),contentInsets:{left:0,top:0,right:0,bottom:0}});
const pack=()=>({scale:1,theme:{},roles:[{role:'skin.button.primary.normal',assetId:'button'},{role:'skin.surface.panel',assetId:'panel'}],assets:[asset('button'),asset('panel')]});
test('role inks distinguish bright buttons and dark panels and bind image evidence',()=>{
 const p=pack(),result=deriveTextReadability(p,new Map([['button',image([245,205,95,255])],['panel',image([25,45,75,255])]]));
 assert.equal(result.inks['skin.button.primary.normal'],policy.dark);assert.equal(result.inks['skin.surface.panel'],policy.light);
 assert.equal(result.report.status,'passed');assert.equal(result.report.productionReady,false);
 assert.equal(result.report.checks[0].sourceSha256,p.assets[0].sha256);assert.equal(p.theme.textColors,undefined);
});
test('mixed texture, transparency and too-small content cannot be a readability pass',()=>{
 for(const surface of [image((x)=>x<32?[0,0,0,255]:[255,255,255,255]),image([20,30,40,128]),image([20,30,40,255],2)]){
  const result=deriveTextReadability(pack(),new Map([['button',surface],['panel',surface]]));assert.equal(result.report.status,'needs-review');
 }
});
test('explicit author inks are preserved and checked; unknown roles are rejected',()=>{
 const p=pack();p.theme.textColors={'skin.surface.panel':'#1A1A1A'};
 const images=new Map([['button',image([250,220,160,255])],['panel',image([25,25,25,255])]]);
 const result=deriveTextReadability(p,images);assert.equal(result.inks['skin.surface.panel'],'#1A1A1A');assert.equal(result.report.status,'needs-review');
 p.theme.textColors['skin.field.typo']='#FFFFFF';assert.throws(()=>deriveTextReadability(p,images),{code:'skin.text-colors'});
});
test('sampling accounts for density and refuses empty safe regions',()=>{
 const a=asset('a');a.density=2;a.contentInsets.left=16;
 const result=sampleSurface(image((x)=>x<32?[255,255,255,255]:[15,25,35,255]),a,1);
 assert(result.colors.every(c=>c[0]===15));a.contentInsets.right=16;assert.equal(sampleSurface(image([0,0,0,255]),a,1).colors.length,0);
});
