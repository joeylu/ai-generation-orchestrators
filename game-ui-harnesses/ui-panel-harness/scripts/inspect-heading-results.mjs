/** Read original saved results; never changes or repairs a model output. */
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--previous','--output'].includes(args[i])&&args[i+1]);options[args[i]]=resolve(args[i+1]);}
assert.equal(Object.keys(options).length,4);
const plan=await readJson(join(options['--prepared'],'input-adaptability-plan.json'));
const report=await readJson(join(options['--run'],'input-adaptability-report.json'));
const previous=await readJson(join(options['--previous'],'input-adaptability-report.json'));
assert.equal(report.planSha256,plan.sha256);assert.equal(report.results.length,plan.cases.length);
const core=await loadWorkspaceCore(),flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
async function observation(root,result){
  if(!result?.delivery)return {outcome:result?.outcome??result?.code??result?.status??'MISSING',delivered:false};
  const bundle=await validatePanelBundle(await readJson(join(root,result.id,'panel.bundle.json')),core);
  const nodes=flatten(bundle.componentBundle.document.root);
  const visible=nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>({id:node.id,text:node.props.text}));
  return {outcome:result.outcome,delivered:true,title:bundle.spec.title,sections:bundle.spec.sections.map(section=>({title:section.title,kinds:section.rows.map(row=>row.kind)})),
    singleUntabbed:!bundle.spec.tabs&&bundle.spec.sections.length===1,visibleHeadings:visible,
    genericOperationHeadings:visible.filter(node=>/^(暂停操作|游戏操作|操作|功能选择|结算操作)$/.test(node.text)),
    scrollViews:nodes.filter(node=>node.type==='ScrollView').map(node=>({id:node.id,height:node.layout.height,contentHeight:node.props.contentHeight})),
    theme:bundle.spec.theme};
}
const rows=[];
for(const item of plan.cases){
  const expectation=await readJson(join(options['--prepared'],item.id+'.expectation.json'));
  rows.push({id:item.id,arm:item.designArm,request:expectation.case.request.text,
    current:await observation(options['--run'],report.results.find(result=>result.id===item.id)),
    previous:await observation(options['--previous'],previous.results.find(result=>result.id===item.id))});
}
function tally(values){
  const delivered=values.filter(row=>row.delivered),single=delivered.filter(row=>row.singleUntabbed);
  return {delivered:delivered.length,singleUntabbed:single.length,singleWithVisibleHeading:single.filter(row=>row.visibleHeadings.length).length,
    withVisibleHeadings:delivered.filter(row=>row.visibleHeadings.length).length,withGenericOperationHeadings:delivered.filter(row=>row.genericOperationHeadings.length).length,
    withScrollViews:delivered.filter(row=>row.scrollViews.length).length};
}
const matched=rows.filter(row=>row.current.delivered&&row.previous.delivered);
const summary={kind:'SAVED_RENDERED_HEADING_OBSERVATIONS',planSha256:plan.sha256,realModelCalls:report.realModelCalls,automaticRetries:report.automaticRetries,
  all:{current:tally(rows.map(row=>row.current)),previous:tally(rows.map(row=>row.previous))},
  matched:{cases:matched.map(row=>row.id),current:tally(matched.map(row=>row.current)),previous:tally(matched.map(row=>row.previous))},
  arms:plan.designComparison.arms.map(arm=>({arm,current:tally(rows.filter(row=>row.arm===arm).map(row=>row.current))})),
  limitations:'Only saved delivered panels are counted. No retry or inferred success. Single samples, potentially unequal delivery sets; matched pairs are reported separately. Generic heading detection is an exact short list for review, not a universal quality score. No claim of skill superiority or isolated causal effect.',rows};
const output=await createOutputDirectory(options['--output']);await writeNewJson(output,'heading-observations.json',summary);
console.log(JSON.stringify({all:summary.all,matched:summary.matched,arms:summary.arms}));
