/** Read-only post-run comparison. Never edits original attempts or assigns aesthetic scores. */
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestJson,digestBytes} from '../src/canonical.mjs';

const options={};
for(let i=2;i<process.argv.length;i+=2){
  assert(['--run','--review','--output'].includes(process.argv[i])&&process.argv[i+1]);
  options[process.argv[i]]=resolve(process.argv[i+1]);
}
assert.equal(Object.keys(options).length,3);
const comparison=await readJson(join(options['--review'],'comparison.json'));
assert.equal(comparison.rows.length,32);
const report=await readJson(join(options['--run'],'input-adaptability-report.json'));
assert.equal(report.planSha256,comparison.planSha256);
function geometry(node){
  return {id:node.id,type:node.type,layout:node.layout,children:(node.children??[]).map(geometry)};
}
function withoutCopy(value){
  if(Array.isArray(value))return value.map(withoutCopy);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,key==='props'
    ? Object.fromEntries(Object.entries(entry).filter(([name])=>!['text','label','title'].includes(name)).map(([name,data])=>[name,withoutCopy(data)]))
    : withoutCopy(entry)]));
}
function differences(left,right,path='$'){
  if(JSON.stringify(left)===JSON.stringify(right))return [];
  if(left&&right&&typeof left==='object'&&typeof right==='object'&&Array.isArray(left)===Array.isArray(right)){
    return [...new Set([...Object.keys(left),...Object.keys(right)])].flatMap(key=>differences(left[key],right[key],path+'.'+key));
  }
  return [{path,before:left??null,after:right??null}];
}
const rows=[],panels=[];
for(let n=1;n<=8;n++){
  const panel='P'+String(n).padStart(2,'0'),group=comparison.rows.filter(row=>row.panelCaseId===panel);
  assert.equal(group.length,4);
  const baseline=await readJson(join(options['--run'],'S0_'+panel,'panel.bundle.json'));
  for(const row of group){
    assert.equal(row.business,'PASS');assert.equal(row.browser,'PASS');
    const bytes=await readFile(join(options['--run'],row.caseId,'panel.bundle.json')),bundle=JSON.parse(bytes);
    const document=bundle.componentBundle.document;
    assert.equal(await digestJson(document),row.layoutSha256);
    rows.push({caseId:row.caseId,panelCaseId:panel,arm:row.arm,alias:row.alias,
      sourceBundleSha256:await digestBytes(bytes),documentSha256:row.layoutSha256,
      geometrySha256:await digestJson(geometry(document.root)),nonCopyDocumentSha256:await digestJson(withoutCopy(document)),
      screenshotSha256:row.screenshotSha256,panelWidth:row.panelWidth,sections:row.sections,
      headings:bundle.spec.sections.map(section=>section.title),
      documentDifferencesFromBaseline:differences(baseline.componentBundle.document,document)});
  }
  const current=rows.filter(row=>row.panelCaseId===panel),unique=key=>new Set(current.map(row=>row[key])).size;
  panels.push({panelCaseId:panel,documentVariants:unique('documentSha256'),geometryVariants:unique('geometrySha256'),
    nonCopyDocumentVariants:unique('nonCopyDocumentSha256'),screenshotByteVariants:unique('screenshotSha256'),
    widths:[...new Set(current.map(row=>row.panelWidth))],sectionCounts:[...new Set(current.map(row=>row.sections))]});
}
const usage=comparison.rows.reduce((result,row)=>{
  const receipt=report.results.find(entry=>entry.id===row.caseId).receipt;
  const arm=result[row.arm]??={calls:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,elapsedMs:0};
  arm.calls++;for(const key of ['inputTokens','cachedInputTokens','outputTokens'])arm[key]+=receipt.usage?.[key]??0;
  arm.elapsedMs+=receipt.elapsedMs;return result;
},{});
const output=await createOutputDirectory(options['--output']);
await writeNewJson(output,'layout-analysis.json',{
  kind:'POST_RUN_LAYOUT_ANALYSIS',planSha256:comparison.planSha256,
  method:{geometry:'Node id, type, exact layout and ordered children; excludes props.',
    nonCopyDocument:'Full component document except props.text, props.label and props.title. Includes every node, layout, other property and style.',
    screenshot:'Exact PNG bytes; differing bytes alone do not prove a visible layout difference.',
    limitations:'One sample per arm/panel; selected excerpts in a constrained runtime. No aesthetic score or causal attribution of stochastic copy differences.'},
  panels,rows,usage,humanVisualReview:'NOT_RECORDED'});
console.log(JSON.stringify({panels,usage}));
