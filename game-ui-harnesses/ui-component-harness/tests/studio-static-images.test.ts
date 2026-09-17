import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDocument } from '../src/fixtures.ts';
import { walkNodes } from '../src/tree-contract.ts';
import { compileMotionSystem, validateMotionSystem } from '../src/motion-system.ts';
import { staticImageTargets, staticImageSystem, staticImageTimeline } from '../src/studio-static-images.ts';

function backgroundFixture() { const ui=fixtureDocument('gallery'); const image=structuredClone(walkNodes(ui).find(n=>n.type==='Image')!); image.id='scene-backdrop'; image.layout={x:0,y:0,...ui.canvas}; if ('children' in ui.root) ui.root.children!.unshift(image); return ui; }
test('Studio styles exclude only full-canvas backdrop and ancestors without mutating authored systems', () => {
  const ui = backgroundFixture(), nodes = walkNodes(ui), blocked = staticImageTargets(ui);
  assert.ok(blocked.has(ui.root.id));
  assert.ok(nodes.some(n => n.type === 'Image' && blocked.has(n.id)));
  assert.ok(nodes.some(n => n.type === 'Button' && !blocked.has(n.id))); assert.equal(blocked.has('balance-gem'),false);
  for (const style of ['playful','premium','corporate'] as const) {
    const system = compileMotionSystem({id:'test',style,targets:nodes.map(n=>n.id)},ui), before=structuredClone(system);
    const result=staticImageSystem(ui,system)!;
    validateMotionSystem(result,ui);
    assert.ok(result.bindings.every(b=>!blocked.has(b.targetId)));
    assert.ok(result.bindings.some(b=>b.componentType==='Button' && b.actions.includes('press')));
    assert.deepEqual(system,before);
    assert.equal(staticImageSystem(ui,{...system,bindings:system.bindings.filter(b=>blocked.has(b.targetId))}),null);
  }
});
test('timeline filtering removes image and parent tracks, preserves control tracks and omits empty documents',()=>{
 const ui=backgroundFixture(),button=walkNodes(ui).find(n=>n.type==='Button')!;
 const track={property:'alpha' as const,start:0,duration:100,from:0,to:1,easing:'linear' as const};
 const motion={motionVersion:'0.1' as const,id:'test',scope:'canvas' as const,duration:100,trigger:{type:'manual' as const},tracks:[{...track,targetId:ui.root.id},{...track,targetId:button.id}]};
 assert.deepEqual(staticImageTimeline(ui,motion)?.tracks,[motion.tracks[1]]);
 assert.equal(motion.tracks.length,2);
 assert.equal(staticImageTimeline(ui,{...motion,tracks:[motion.tracks[0]]}),undefined);
});

