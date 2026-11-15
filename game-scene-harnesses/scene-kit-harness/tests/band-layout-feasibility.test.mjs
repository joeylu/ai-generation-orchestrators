import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bandLayoutFeasibility} from '../src/generation/band-layout-feasibility.mjs';

const base=()=>({sourceSize:{width:100,height:100},coverage:{x:[0,100],y:[0,100]},scale:[1,2],translation:{x:[-100,0],y:[-100,0]},features:[]});
test('full frame and uncertainty intervals produce an executable shared-scale witness',()=>{
  const v=base();v.features=[{featureId:'a',native:{x:[.48,.52],y:[.48,.52]},target:{x:[45,55],y:[45,55]}}];
  const r=bandLayoutFeasibility(v);assert.equal(r.status,'feasible');const s=r.witness.scale;
  for(const axis of ['x','y']){const t=r.witness[axis],n=v.features[0].native[axis],d=v.features[0].target[axis];
    assert(t<=0&&t+s*100>=100);assert(t+s*100*n[0]>=d[0]-1e-10&&t+s*100*n[1]<=d[1]+1e-10);}
  assert.equal(r.alpha,'not-assessed');assert.equal(r.visualAcceptance,'not-assessed');
});
test('coverage, target uncertainty, and cross-axis shared scale can be infeasible',()=>{
  const v=base();v.features=[{featureId:'a',native:{x:[.8,.8],y:[.5,.5]},target:{x:[20,30],y:[0,100]}}];
  assert.equal(bandLayoutFeasibility(v).status,'infeasible');
  const w=base();w.coverage={x:[0,0],y:[0,0]};w.translation={x:[0,0],y:[0,0]};w.scale=[.1,2];
  w.features=[{featureId:'a',native:{x:[.5,.5],y:[.5,.5]},target:{x:[25,25],y:[75,75]}}];
  assert.equal(bandLayoutFeasibility(w).status,'infeasible');
  const a=base();a.features=[{featureId:'a',native:{x:[.4,.6],y:[.5,.5]},target:{x:[48,52],y:[0,100]}}];
  assert.equal(bandLayoutFeasibility(a).status,'infeasible');
});
test('invalid and unbounded data reject',()=>{
  const v=base();v.scale=[0,2];assert.throws(()=>bandLayoutFeasibility(v));
  const w=base();w.features=[{featureId:'a',native:{x:[-.1,.5],y:[0,.5]},target:{x:[0,100],y:[0,100]}}];assert.throws(()=>bandLayoutFeasibility(w));
  const z=base();z.translation.x=[-Infinity,0];assert.throws(()=>bandLayoutFeasibility(z));
});
