/** Post-run observations only. No semantic/aesthetic success ratings are inferred. */
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {readJson,writeNewJson,createOutputDirectory} from '../src/io.mjs';
const options={};
for(let i=2;i<process.argv.length;i+=2){assert(['--prepared','--run','--browser','--output'].includes(process.argv[i])&&process.argv[i+1]);options[process.argv[i]]=resolve(process.argv[i+1]);}
assert.equal(Object.keys(options).length,4);
const plan=await readJson(join(options['--prepared'],'input-adaptability-plan.json'));
const report=await readJson(join(options['--run'],'input-adaptability-report.json'));
const browser=await readJson(join(options['--browser'],'browser-report.json'));
assert.equal(plan.cohort,'short-input-v1');assert.equal(report.planSha256,plan.sha256);assert.equal(browser.planSha256,plan.sha256);
assert.equal(report.results.length,plan.cases.length);
const rows=[];
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
for(const entry of plan.cases){
  const item=report.results.find(result=>result.id===entry.id);assert(item);
  const expectation=await readJson(join(options['--prepared'],entry.id+'.expectation.json'));assert.equal(expectation.expectedSpec,null);
  const row={id:entry.id,panelCaseId:entry.panelCaseId,arm:entry.designArm,request:expectation.case.request.text,
    inputKind:expectation.case.evaluation.explicit?'EXPLICIT_SHORT':'OPEN_SHORT',
    outcome:item.status==='NOT_RUN'?'NOT_RUN':item.status==='FAIL'?item.indeterminate?'INDETERMINATE_CONNECTION':'VALIDATION_FAILURE':item.outcome==='NEEDS_INPUT'?'CLARIFICATION':'DRAFT',
    code:item.code??null,diagnostic:item.diagnostic??null,browser:browser.results.find(result=>result.id===entry.id)?.status??'NOT_APPLICABLE'};
  if(item.status==='PASS')row.review=await readJson(join(options['--run'],entry.id,'draft-review.json'));
  if(item.delivery){
    const bundle=await readJson(join(options['--run'],entry.id,'panel.bundle.json'));
    row.canvas=bundle.spec.canvas;row.panelWidth=bundle.spec.layout.width;row.maxHeight=bundle.spec.layout.maxHeight;
    row.sections=bundle.spec.sections.map(section=>({title:section.title,rows:section.rows.length}));
    row.scrollViews=flatten(bundle.componentBundle.document.root).filter(node=>node.type==='ScrollView').map(node=>({id:node.id,layout:node.layout,contentWidth:node.props.contentWidth,contentHeight:node.props.contentHeight}));
  }
  rows.push(row);
}
const outcomes=['DRAFT','CLARIFICATION','VALIDATION_FAILURE','INDETERMINATE_CONNECTION','NOT_RUN'];
const tally=items=>Object.fromEntries(outcomes.map(outcome=>[outcome,items.filter(row=>row.outcome===outcome).length]));
const arms=plan.designComparison.arms.map(arm=>({arm,all:tally(rows.filter(row=>row.arm===arm)),open:tally(rows.filter(row=>row.arm===arm&&row.inputKind==='OPEN_SHORT')),explicit:tally(rows.filter(row=>row.arm===arm&&row.inputKind==='EXPLICIT_SHORT'))}));
const summary={kind:'SHORT_INPUT_OBSERVATIONS',planSha256:plan.sha256,realModelCalls:report.realModelCalls,automaticRetries:report.automaticRetries,
  totals:tally(rows),arms,browser:{panels:browser.panels,checks:browser.checks,status:browser.status},
  contentQuality:'HUMAN_REVIEW_REQUIRED',clarificationNecessity:'HUMAN_REVIEW_REQUIRED',visualQuality:'HUMAN_REVIEW_REQUIRED',
  limitations:'Single sample per condition. Incomplete cohort due to terminal connection failure. Counts are not population success rates. Drafts may contain unwanted assumptions or initial scroll clipping despite browser interaction passing.',rows};
const output=await createOutputDirectory(options['--output']);await writeNewJson(output,'summary.json',summary);
console.log(JSON.stringify({totals:summary.totals,arms,browser:summary.browser,scrolling:rows.filter(row=>row.scrollViews?.length).map(row=>({id:row.id,scrollViews:row.scrollViews}))}));
