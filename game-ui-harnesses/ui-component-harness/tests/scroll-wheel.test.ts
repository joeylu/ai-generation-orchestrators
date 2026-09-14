import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollWheelDelta} from '../src/scroll-wheel.ts';
const viewport={width:300,height:200};
test('pixel wheel retains signed and fractional values',()=>{
 assert.deepEqual(scrollWheelDelta({deltaMode:0,deltaX:-2.5,deltaY:17.25},viewport),{x:-2.5,y:17.25});
});
test('line wheel uses the explicit 40-unit keyboard-compatible input step',()=>{
 assert.deepEqual(scrollWheelDelta({deltaMode:1,deltaX:-2,deltaY:3},viewport),{x:-80,y:120});
 assert.deepEqual(scrollWheelDelta({deltaMode:1,deltaX:0.25,deltaY:-0.5},viewport),{x:10,y:-20});
});
test('page wheel uses corresponding axis dimensions including fractional pages',()=>{
 assert.deepEqual(scrollWheelDelta({deltaMode:2,deltaX:1,deltaY:-1},viewport),{x:300,y:-200});
 assert.deepEqual(scrollWheelDelta({deltaMode:2,deltaX:-0.5,deltaY:0.25},viewport),{x:-150,y:50});
});
test('malformed modes, nonfinite deltas and overflowing conversions are not guessed',()=>{
 for(const deltaMode of [-1,3,0.5,NaN])assert.equal(scrollWheelDelta({deltaMode,deltaX:0,deltaY:1},viewport),null);
 for(const deltaY of [NaN,Infinity,-Infinity])assert.equal(scrollWheelDelta({deltaMode:0,deltaX:0,deltaY},viewport),null);
 assert.equal(scrollWheelDelta({deltaMode:2,deltaX:0,deltaY:Number.MAX_VALUE},viewport),null);
 assert.equal(scrollWheelDelta({deltaMode:1,deltaX:0,deltaY:1},{width:300,height:0}),null);
});
