import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelViewportFit,observePanelViewport} from '../src/panel-viewport.mjs';

function fixture(width) {
  const canvas={width:484,height:334},container={clientWidth:width,style:{}},surface={style:{}},zooms=[];
  const fit=createPanelViewportFit(canvas,container,surface,{setZoom:value=>zooms.push(value)});
  return{canvas,container,surface,zooms,fit};
}
test('height notifications and identical widths never reallocate the drawing buffer',()=>{
  const f=fixture(408);assert.equal(f.fit(),true);
  const styles=structuredClone([f.surface.style,f.container.style]);
  for(let i=0;i<200;i++)assert.equal(f.fit(),false);
  assert.deepEqual(f.zooms,[408/484]);assert.deepEqual([f.surface.style,f.container.style],styles);
  f.container.clientWidth=393;assert.equal(f.fit(),true);assert.deepEqual(f.zooms,[408/484,393/484]);
  assert.equal(f.fit(),false);assert.deepEqual(f.canvas,{width:484,height:334});
});
test('widths below the runtime minimum change CSS scale without resetting gestures',()=>{
  const f=fixture(200);f.fit();assert.deepEqual(f.zooms,[0.5]);
  f.container.clientWidth=180;f.fit();assert.deepEqual(f.zooms,[0.5]);
  assert.equal(f.surface.style.transform,`scale(${180/484/0.5})`);
  assert.equal(f.surface.style.width,'242px');assert.equal(f.container.style.height,`${334*180/484}px`);
});
test('wide hosts retain natural size and hidden hosts can become visible',()=>{
  const f=fixture(800);f.fit();assert.deepEqual(f.zooms,[]);
  assert.equal(f.surface.style.width,'484px');assert.equal(f.container.style.height,'334px');
  f.container.clientWidth=1000;assert.equal(f.fit(),false);
  f.container.clientWidth=0;assert.equal(f.fit(),true);assert.deepEqual(f.zooms,[0.5]);
  f.container.clientWidth=484;assert.equal(f.fit(),true);assert.deepEqual(f.zooms,[0.5,1]);
});

test('observer notifications coalesce outside delivery and teardown cancels the pending frame',()=>{
  const f=fixture(484),tasks=new Map();let callback,disconnected=0,serial=0;
  class Observer{constructor(fn){callback=fn;}observe(target){assert.equal(target,f.container);}disconnect(){disconnected++;}}
  const stop=observePanelViewport(f.canvas,f.container,f.surface,{setZoom:value=>f.zooms.push(value)},{Observer,clock:{request:fn=>{tasks.set(++serial,fn);return serial;},cancel:id=>tasks.delete(id)}});
  f.container.clientWidth=393;for(let i=0;i<20;i++)callback();
  assert.deepEqual(f.zooms,[],'no DOM/buffer changes within observer delivery');assert.equal(tasks.size,1);
  const [id,tick]=[...tasks][0];tasks.delete(id);tick();assert.deepEqual(f.zooms,[393/484]);
  callback();const queued=[...tasks.values()][0];stop();stop();assert.equal(disconnected,1);assert.equal(tasks.size,0);
  f.container.clientWidth=350;queued();assert.deepEqual(f.zooms,[393/484],'stale frame cannot write to a destroyed view');
});
