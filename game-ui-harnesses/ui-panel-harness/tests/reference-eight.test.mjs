import test from 'node:test';
import assert from 'node:assert/strict';
import {REFERENCE_EIGHT_CASES} from '../examples/reference-eight-v1/suite.mjs';
import {templateList,templateInput} from '../../ui-reference-harness/web/template-previews.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {checkAdaptabilityResult} from '../scripts/lib/input-adaptability-oracle.mjs';
const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
test('eight scenarios map one-to-one to the currently selected reference templates',()=>{
  assert.deepEqual(REFERENCE_EIGHT_CASES.map(item=>item.sourcePanelId),templateList.map(item=>item.id));
});
for(const item of REFERENCE_EIGHT_CASES)test(`${item.id} preserves selected source content and produces a valid independent reference`,async()=>{
  const {spec}=await templateInput(item.sourcePanelId),before=JSON.stringify(spec);
  assert.equal(item.reference.title,spec.title);
  if(spec.document){
    const nodes=flatten(spec.document.root),copy=nodes.filter(n=>n.type==='Text').map(n=>n.props.text);
    assert.deepEqual(item.reference.rows.filter(r=>r.kind==='button').map(r=>r.label),nodes.filter(n=>n.type==='Button').map(n=>n.props.label));
    for(const row of item.reference.rows.filter(r=>r.kind==='text'&&r.label!=='加载占位'))assert(copy.includes(row.text));
    const row=item.reference.rows.find(r=>r.kind==='progress');
    if(row){const progress=nodes.find(n=>n.type==='ProgressBar');assert.equal(row.initial,progress.props.value);assert.equal(row.max,progress.props.max);}
  }else{
    assert.deepEqual(item.reference.rows.map(row=>row.kind),spec.sections.flatMap(section=>section.rows.map(row=>row.kind)));
    assert.deepEqual(item.reference.rows.filter(row=>row.kind==='switch').map(row=>row.initial),spec.state.filter(field=>field.type==='boolean').map(field=>field.initial));
  }
  const context=await createPlanningContext(item.request,catalog),proposal=await materializePanelIntent(context,referenceIntent(context,item));
  const bundle=await createPanelBundle(proposal.spec,catalog,core);
  checkAdaptabilityResult(item,{proposal,report:{status:'READY_TO_COMPILE'}},{expectedSpec:proposal.spec,after:bundle});
  const wrong=structuredClone(proposal);wrong.spec.canvas.width=961;
  assert.throws(()=>checkAdaptabilityResult(item,{proposal:wrong,report:{status:'READY_TO_COMPILE'}},{expectedSpec:proposal.spec,after:bundle}),/ADAPT_CANVAS/);
  assert.equal(JSON.stringify(spec),before);
});
