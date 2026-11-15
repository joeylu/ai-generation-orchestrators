import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash,jsonBytes,seal} from '../src/generation/common.mjs';

test('manifest verification reads each artifact once and rejects tampering and extra files', async t => {
  const root=fs.mkdtempSync(join(tmpdir(),'scene-proof-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(join(root,'source'));
  const payload=Buffer.from('original');
  fs.writeFileSync(join(root,'source','native.png'),payload);
  const bundle=seal({format:'test',artifacts:[{path:'source/native.png',sha256:hash(payload),byteLength:payload.length}]});
  const bundleBytes=jsonBytes(bundle);fs.writeFileSync(join(root,'proof-bundle.json'),bundleBytes);
  const {readManifestProofBundle}=await import('../src/terrain-proof/bundle.mjs');
  const original=fs.readFileSync;let reads=0;
  try {
    fs.readFileSync=function(path,...args){if(String(path)===join(root,'source','native.png'))reads++;return original.call(this,path,...args);};
    syncBuiltinESMExports();
    assert.deepEqual(readManifestProofBundle(root).files.get('source/native.png'),payload);
    assert.equal(reads,1);
  } finally {fs.readFileSync=original;syncBuiltinESMExports();}
  fs.writeFileSync(join(root,'source','native.png'),'tampered');
  assert.throws(()=>readManifestProofBundle(root));
  fs.writeFileSync(join(root,'source','native.png'),payload);
  fs.writeFileSync(join(root,'extra'),'unexpected');
  assert.throws(()=>readManifestProofBundle(root));
  fs.rmSync(join(root,'extra'));
  const oversized=seal({format:'test',artifacts:bundle.artifacts,padding:'x'.repeat(2097152)});
  fs.writeFileSync(join(root,'proof-bundle.json'),jsonBytes(oversized));
  assert.throws(()=>readManifestProofBundle(root),error=>error.errors?.some(issue=>issue.code==='RESOURCE_LIMIT'));
});
