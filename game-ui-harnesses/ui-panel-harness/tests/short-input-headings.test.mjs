import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {SHORT_INPUT_REQUESTS} from '../examples/short-input-comparison-v1/suite.mjs';
import {businessFacts} from '../scripts/lib/input-adaptability-oracle.mjs';
const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
const headings=bundle=>flatten(bundle.componentBundle.document.root).filter(node=>/\.section\.[^.]+\.title$/.test(node.id));
for(const index of [0,3,6,7])test(`short input ${index+1}: matching single-section title removes subtitle without changing business`,async()=>{
  const item=SHORT_INPUT_REQUESTS[index],context=await createPlanningContext(item.request,catalog);
  const intent=referenceIntent(context,item);intent.panel.layout={width:640,canvasWidth:720,canvasHeight:900,maxHeight:800,overflow:'auto'};
  const before=await materializePanelIntent(context,intent);
  intent.panel.body.children[0].title=intent.panel.title;
  const after=await materializePanelIntent(context,intent);
  assert.deepEqual(businessFacts(after.spec),businessFacts(before.spec));
  const original=await createPanelBundle(before.spec,catalog,core),bundle=await createPanelBundle(after.spec,catalog,core);
  assert.equal(headings(bundle).length,0);assert.deepEqual(bundle.actions,original.actions);assert.deepEqual(bundle.state,original.state);
  assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  if(index!==0){assert.equal(headings(original).length,1);assert(bundle.spec.layout.maxHeight===original.spec.layout.maxHeight);}
});
