import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seal,hash,unseal} from '../src/generation/common.mjs';
import {checkCaptureBinding} from '../src/coherent-recomposition-review.mjs';

const png=readFileSync(new URL('./fixtures/synthetic/assets/terrain-000.png',import.meta.url));
const delivery=seal({format:'ai_scene_coherent_delivery_v1',authorSha256:'a'.repeat(64),kitSha256:'b'.repeat(64)});
function capture(changes={}) { return seal({format:'ai_scene_coherent_studio_capture_v1',deliverySha256:delivery.sha256,
  authorSha256:delivery.authorSha256,identity:true,nonblank:true,actualStudioFrame:true,editorVisibilityDoesNotChangeMap:true,
  browserSaveVerified:true,browserZipEqualsCli:true,errors:[],warnings:[],externalRequests:[],
  artifacts:[{path:'studio-scene.png',sha256:hash(png),byteLength:png.length}],...changes}); }
test('binds the actual captured bytes, author and delivery to the checked review inputs',()=>{
  assert.deepEqual(checkCaptureBinding(delivery,capture(),png),{mapSha256:delivery.authorSha256,kitSha256:delivery.kitSha256});
  assert.throws(()=>checkCaptureBinding(delivery,capture({authorSha256:'c'.repeat(64)}),png));
  assert.throws(()=>checkCaptureBinding(delivery,capture({deliverySha256:'c'.repeat(64)}),png));
  assert.throws(()=>checkCaptureBinding(delivery,capture(),Buffer.concat([png,Buffer.from([1])])));
});
test('rejects broken capture checks, ambiguous artifact identity and changed sealed proof',()=>{
  assert.throws(()=>checkCaptureBinding(delivery,capture({actualStudioFrame:false}),png));
  assert.throws(()=>checkCaptureBinding(delivery,capture({warnings:['warning']}),png));
  const artifact={path:'studio-scene.png',sha256:hash(png),byteLength:png.length};
  assert.throws(()=>checkCaptureBinding(delivery,capture({artifacts:[artifact,artifact]}),png));
  assert.throws(()=>checkCaptureBinding(delivery,{...capture(),browserZipEqualsCli:false},png));
});

test('native perimeter deliveries require their own exact Studio capture; a base material capture cannot transfer',()=>{
  const native=seal({...unseal(delivery),format:'ai_scene_terrain_edge_delivery_v1'});
  assert.throws(()=>checkCaptureBinding(native,capture(),png));
  assert.deepEqual(checkCaptureBinding(native,capture({deliverySha256:native.sha256}),png),{mapSha256:native.authorSha256,kitSha256:native.kitSha256});
  assert.throws(()=>checkCaptureBinding(native,capture({deliverySha256:native.sha256,actualStudioFrame:false}),png));
});
