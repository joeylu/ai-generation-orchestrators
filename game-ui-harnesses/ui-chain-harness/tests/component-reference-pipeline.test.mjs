import test from 'node:test';
import assert from 'node:assert/strict';
import {componentReferenceFixture,checkComponentPipeline} from '../scripts/component-pipeline-check.mjs';
import {decodePng} from '../src/skins/png.mjs';

test('reference-stage fixture is varied opaque PNG, separate from transparent atlas fixtures',()=>{
 const first=componentReferenceFixture(256,256),second=componentReferenceFixture(256,256),image=decodePng(first),colors=new Set();
 assert.deepEqual(first,second);assert.equal(image.width,256);assert.equal(image.height,256);
 for(let at=0;at<image.pixels.length;at+=4){assert.equal(image.pixels[at+3],255);colors.add(image.pixels.readUInt32BE(at));}
 assert(colors.size>256,'The reference QA fixture must not be an empty or solid-colour image.');
});

test('reference mode and synthetic size reject invalid inputs before any pipeline work or calls',async()=>{
 for(const value of ['true',1,null])await assert.rejects(()=>checkComponentPipeline({generateReference:value}),/REFERENCE_MODE_INVALID/);
 for(const [width,height] of [[0,96],[160,0],[2049,96],[160,2049],[16.5,96]])assert.throws(()=>componentReferenceFixture(width,height),/FIXTURE_SIZE_INVALID/);
});
