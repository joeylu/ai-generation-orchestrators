import test from 'node:test';
import assert from 'node:assert/strict';
import { verticalTabsFixture, verticalTabsHandoff } from './helpers/vertical-tabs-fixture.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { validateBundle } from '../src/bundle.ts';
import { importAndApplyComponentHandoff } from '../src/component-handoff.ts';

test('vertical native Tabs retain left rail, right pages and independent resources', async () => {
  const b:any=await importAndApplyComponentHandoff(await verticalTabsHandoff());
  const n=b.document.root.children[0];
  assert.deepEqual(n.props.appearance.layoutPolicy,{version:'1.0',orientation:'vertical'});
  assert.deepEqual(n.props.appearance.items.map((i:any)=>[i.layout.x,i.layout.y]),[[0,0],[0,76],[0,152]]);
  assert(n.children.every((c:any)=>c.layout.x===200));
  assert.equal(b.resources.length,12);await validateBundle(b);
});

test('vertical policy rejects unknown fields/version, missing items, overlap, order and geometry', async () => {
  for(const mutation of ['version','field','items','overlap','order','x','out','base'] as const){
    const f=await verticalTabsFixture(), b:any=structuredClone(f.binding),s=b.bindings[0].states.tabs;
    if(mutation==='version')s.layoutPolicy.version='2.0';
    if(mutation==='field')s.layoutPolicy.padding=20;
    if(mutation==='items')delete s.items;
    if(mutation==='overlap')s.items[1].layout.y=2;
    if(mutation==='order')s.items.reverse();
    if(mutation==='x')s.items[1].layout.x=1;
    if(mutation==='out')s.items[2].layout.y=10000;
    if(mutation==='base')b.bindings[0].parts=b.bindings[0].parts.filter((p:any)=>p.role!=='active-tab'||p.tabId!=='audio');
    await assert.rejects(applyAppearanceBinding(f.target,f.imported,b));
  }
});

test('direct bundles reject policy corruption and vertical y without opt-in', async()=>{
  const b:any=await importAndApplyComponentHandoff(await verticalTabsHandoff());
  for(const mutation of ['version','field','items','legacy','order','width','missingResource','digest'] as const){
    const d=structuredClone(b),a=d.document.root.children[0].props.appearance;
    if(mutation==='version')a.layoutPolicy.version='0';
    if(mutation==='field')a.layoutPolicy.extra=true;
    if(mutation==='items')delete a.items;
    if(mutation==='legacy')delete a.layoutPolicy;
    if(mutation==='order')a.items.reverse();
    if(mutation==='width')a.items[0].tabCanvas.width++;
    if(mutation==='missingResource')d.resources=d.resources.filter((r:any)=>r.path!==a.items[1].activeTabImage);
    if(mutation==='digest')d.resources[0].sha256='0'.repeat(64);
    await assert.rejects(validateBundle(d));
  }
});
