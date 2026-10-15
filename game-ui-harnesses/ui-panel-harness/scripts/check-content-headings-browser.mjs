#!/usr/bin/env node
/** Observe original heading-policy deliveries. No provider calls, edits or repairs. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const input=resolve(args[1]),source=await readJson(resolve(input,'input-adaptability-report.json'));assert(['readable-heading-v1','readable-layout-v1'].includes(source.cohort));
const output=await createOutputDirectory(args[3]),{chromium}=await loadWorkspaceTool('@playwright/test'),browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),results=[],errors=[],warnings=[];
const flat=node=>[node,...(node.children??[]).flatMap(flat)],normalized=text=>text.trim().replace(/(?:界面|面板)$/,'');
try{
 const context=await browser.newContext({viewport:{width:1100,height:1800},reducedMotion:'reduce',serviceWorkers:'block'});await context.route('**/*',route=>['file:','data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():(errors.push('EXTERNAL_NETWORK'),route.abort()));const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
 for(const item of source.results){
  if(!item.delivery){results.push({id:item.id,status:'NOT_EVALUATED_NO_DELIVERY',originalStatus:item.status});continue;}
  const bundle=await readJson(resolve(input,item.id,'panel.bundle.json')),views=[];let failure=null;
  try{
   assert.equal(bundle.compilerVersion,source.cohort==='readable-layout-v1'?'0.39.0':'0.38.0');assert.equal(bundle.catalog.themes[0].headingStyle,'concise-v5','SHORT_REQUEST_SHOULD_USE_CONCISE_DEFAULT');
   for(const viewport of [{width:1100,height:1800},{width:390,height:844},{width:375,height:812}]){
    await page.setViewportSize(viewport);const url=pathToFileURL(resolve(input,item.id,'delivery/pixi/index.html')).href;await page.goto(url);assert.equal(page.url(),url);assert.equal(await page.title(),'面板交付预览');await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status')?.dataset.state));assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),bundle.state);
    for(const tab of bundle.spec.tabs?.pages??[null]){
     await page.evaluate(({state,bind,id})=>window.panelDelivery.panel.setState({...state,...(bind?{[bind]:id}:{})}),{state:bundle.state,bind:bundle.spec.tabs?.bind??null,id:tab?.id??null});
     const groups=bundle.spec.sections.filter(section=>(!tab||tab.sections.includes(section.id))&&section.rows.some(row=>row.kind!=='button'));
     const expected=groups.length<=1?[]:groups.filter(section=>normalized(section.title)!==normalized(bundle.spec.title)&&(!tab||normalized(section.title)!==normalized(tab.label))).map(section=>section.title);
     const inspection=await page.evaluate(()=>window.panelDelivery.inspect()),visible=new Map(inspection.nodes.filter(node=>node.visible).map(node=>[node.id,node])),headings=flat(bundle.componentBundle.document.root).filter(node=>/\.section\.[^.]+\.title$/.test(node.id)&&visible.has(node.id));
     assert.deepEqual(headings.map(node=>node.props.text),expected,'NATIVE_HEADING_PRESENTATION');for(const heading of headings)assert(visible.get(heading.id).renderedTextBounds?.some(glyph=>glyph.bounds.width>0&&glyph.bounds.height>0),'HEADING_GLYPHS_MISSING');
     const name=item.id+'-'+viewport.width+'-'+(tab?.id??'body')+'.png';await page.locator('canvas').screenshot({path:resolve(output,name)});views.push({viewport,page:tab?.id??null,status:'PASS',contentGroups:groups.length,expectedHeadings:expected,actualHeadings:headings.map(node=>node.props.text),capture:{path:name,sha256:await digestBytes(await readFile(resolve(output,name)))}});
    }
   }
  }catch(error){failure=error.message;}
  results.push({id:item.id,panelSha256:bundle.sha256,status:failure?'FAIL':'PASS',failure,views});console.log(JSON.stringify({id:item.id,status:results.at(-1).status,failure}));
 }
 const status=results.every(item=>item.status==='PASS')&&!errors.length?'PASS':'FAIL';await writeNewJson(output,'heading-report.json',{status,kind:'ORIGINAL_NATIVE_CONTENT_HEADING_OBSERVATIONS',sourceKind:source.kind??'REAL_MODEL_BATCH',sourceRealModelCalls:source.realModelCalls,planSha256:source.planSha256,results,errors,warnings,realModelCalls:0,humanReview:'NOT_RECORDED',browserPath:'Browser plugin not available; local Playwright/Edge'});if(status!=='PASS')process.exitCode=1;
}finally{await browser.close();}
