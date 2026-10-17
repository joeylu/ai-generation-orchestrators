import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastInk,opaqueMedian} from '../src/studio/canvas-contrast.mjs';
test('preview ink distinguishes dark panels, light buttons and the dark canvas',()=>{
 for(const background of [[30,53,91],[11,16,22]]){const ink=contrastInk(background);assert.equal(ink.fill,'#f5f7ff');assert.ok(ink.ratio>=4.5);}
 for(const background of [[255,201,75],[246,234,211]]){const ink=contrastInk(background);assert.equal(ink.fill,'#111827');assert.ok(ink.ratio>=4.5);}
});
test('transparent image RGB cannot determine text color',()=>{
 const pixels=Uint8Array.from([...Array.from({length:32},()=>[255,255,255,0]).flat(),...Array.from({length:16},()=>[30,53,91,255]).flat()]);
 assert.deepEqual(opaqueMedian(pixels),[30,53,91]);assert.equal(opaqueMedian(new Uint8Array(256)),null);
});
