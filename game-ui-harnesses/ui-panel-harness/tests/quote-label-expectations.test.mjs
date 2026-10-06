import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { QUOTE_RECHECK_SUITE,quoteRecheckFixture } from '../examples/quote-recheck-v1/suite.mjs';
import { quoteRecheckExpectationVariants,QUOTE_LABEL_CORRECTION } from '../examples/quote-recheck-v2/expectations.mjs';
const catalog=await readJson(new URL('../examples/modern-mint-forms.catalog.json',import.meta.url));
const item=QUOTE_RECHECK_SUITE.cases.find(value=>value.id==='quote-tabs-progress');
const context=await createPlanningContext(item.request,catalog),base=(await materializePanelIntent(context,quoteRecheckFixture(context,item))).spec;
const variants=quoteRecheckExpectationVariants(item);
const accepted=spec=>variants.some(expected=>evaluatePanelSemantics(spec,expected).status==='PASS');
const progress=spec=>spec.sections.flatMap(section=>section.rows).find(row=>row.kind==='progress');

test('fixed generic loading-bar request accepts exactly its two justified labels without modifying source expectations',()=>{
  const before=structuredClone(item);assert.equal(variants.length,2);assert.equal(QUOTE_LABEL_CORRECTION.requestQuote,item.request.text.match(/以及加载进度条[^。]+/u)[0]);
  for(const label of ['加载进度','加载进度条']){const value=structuredClone(base);progress(value).label=label;assert(accepted(value));}
  for(const label of ['下载进度','加载','进度','仅加载进度','LOADING']){const value=structuredClone(base);progress(value).label=label;assert(!accepted(value));}
  assert.deepEqual(item,before);assert.equal(item.expected.rows[4].label,'加载进度');
});
test('alternate label cannot hide changed progress values, format, tab defaults, membership, ordering or reset scope',()=>{
  const edits=[value=>{value.state.find(field=>field.type==='progress').initial=.3;},value=>{value.state.find(field=>field.type==='progress').max=2;},
    value=>{progress(value).format.fractionDigits=0;},value=>{progress(value).format.mode='value';},
    value=>{value.state.find(field=>field.id===value.tabs.bind).initial='page1';},value=>{value.tabs.pages.reverse();value.state.find(field=>field.id===value.tabs.bind).options.reverse();},
    value=>{const section=value.sections[1];section.rows.reverse();},
    value=>{const reset=value.sections[0].rows.find(row=>row.kind==='button');reset.action.fields.push('row3');},
    value=>{const row=progress(value);value.sections[1].rows.pop();value.sections[0].rows.push(row);}];
  for(const edit of edits){const value=structuredClone(base);progress(value).label='加载进度条';edit(value);assert(!accepted(value));}
});
test('other requests and explicit label changes never receive an inferred alias',()=>{
  for(const other of QUOTE_RECHECK_SUITE.cases.filter(value=>value.id!==item.id))assert.deepEqual(quoteRecheckExpectationVariants(other),[other.expected]);
  for(const change of [value=>{value.request.text+='标签必须叫“加载进度”。';},value=>{value.expected.rows[4].label='下载进度';},value=>{value.id='other';}]){
    const changed=structuredClone(item);change(changed);assert.throws(()=>quoteRecheckExpectationVariants(changed),/QUOTE_ORACLE_SOURCE_MISMATCH/);
  }
});
