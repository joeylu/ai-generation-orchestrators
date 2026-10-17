import test from 'node:test';
import assert from 'node:assert/strict';
import {frameCamera,zoomCamera,panCamera,resizeCamera} from '../src/studio/panel-camera.mjs';

const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const logical=(camera,point)=>({x:(point.x-camera.x)/camera.scale,y:(point.y-camera.y)/camera.scale});

test('focus centers a nonzero rectangle while fit limits magnification and narrow padding stays usable',()=>{
  const rect={x:300,y:-80,width:200,height:100},before=structuredClone(rect),view={width:800,height:600};
  const focus=frameCamera(rect,view);assert.deepEqual(focus,{x:-600,y:375,scale:2.5,mode:'focus'});
  const center=logical(focus,{x:400,y:300});near(center.x,400);near(center.y,-30);
  const fit=frameCamera(rect,view,{maxScale:1,mode:'fit'});assert.equal(fit.scale,1);assert.equal(fit.mode,'fit');
  const narrow=frameCamera({x:0,y:0,width:100,height:100},{width:20,height:12});assert.equal(narrow.scale,.1);near(narrow.x+50*narrow.scale,10);near(narrow.y+50*narrow.scale,6);
  const overflow=frameCamera({x:-20,y:10,width:10000,height:10000},{width:20,height:12});assert.equal(overflow.scale,.1);assert(overflow.x<0);
  assert.deepEqual(rect,before);
});

test('zoom preserves its viewport-local anchor through both scale clamps and panning is independent',()=>{
  const original={x:-120,y:30,scale:.8,mode:'focus'},anchor={x:145,y:91},before=logical(original,anchor);
  for(const [requested,expected]of [[1.6,1.6],[8,2.5],[.001,.1]]){
    const next=zoomCamera(original,requested,anchor),after=logical(next,anchor);
    assert.equal(next.scale,expected);assert.equal(next.mode,'manual');near(after.x,before.x);near(after.y,before.y);
  }
  assert.deepEqual(panCamera(original,80,-15),{x:-40,y:15,scale:.8,mode:'manual'});
  assert.deepEqual(original,{x:-120,y:30,scale:.8,mode:'focus'});
});

test('manual viewport resize keeps the center logical point; fit and focus await reframing',()=>{
  const oldView={width:640,height:480},newView={width:310,height:750},manual={x:-90,y:45,scale:1.25,mode:'manual'};
  const before=logical(manual,{x:oldView.width/2,y:oldView.height/2}),next=resizeCamera(manual,oldView,newView),after=logical(next,{x:newView.width/2,y:newView.height/2});
  near(after.x,before.x);near(after.y,before.y);assert.equal(next.scale,manual.scale);assert.equal(next.mode,'manual');
  for(const mode of ['fit','focus']){const camera={...manual,mode};assert.deepEqual(resizeCamera(camera,oldView,newView),camera);assert.notEqual(resizeCamera(camera,oldView,newView),camera);}
});

test('nonfinite values, empty rectangles, invalid viewports and unordered scale ranges fail explicitly',()=>{
  const rect={x:0,y:0,width:100,height:50},view={width:800,height:600},camera={x:0,y:0,scale:1,mode:'manual'};
  for(const invoke of [()=>frameCamera({...rect,x:NaN},view),()=>frameCamera({...rect,width:0},view),()=>frameCamera(rect,{...view,height:-1}),()=>frameCamera(rect,view,{padding:-1}),()=>frameCamera(rect,view,{minScale:2,maxScale:1}),()=>frameCamera(rect,view,{mode:'unknown'}),()=>zoomCamera(camera,Infinity,{x:0,y:0}),()=>zoomCamera(camera,0,{x:0,y:0}),()=>zoomCamera(camera,1,{x:'0',y:0}),()=>panCamera(camera,NaN,0),()=>resizeCamera({...camera,scale:0},view,view),()=>resizeCamera(camera,view,{width:0,height:10})])assert.throws(invoke,{code:'studio.camera'});
});
