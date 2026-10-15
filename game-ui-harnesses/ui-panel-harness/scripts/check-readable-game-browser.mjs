#!/usr/bin/env node
/** Unmodified original deliveries only. No model calls, proposal edits or display repairs. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {digestBytes} from '../src/canonical.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const input=resolve(args[1]),report=await readJson(resolve(input,'input-adaptability-report.json'));assert(['readable-game-v1','readable-heading-v1','readable-layout-v1'].includes(report.cohort));
const output=await createOutputDirectory(args[3]),{chromium}=await loadWorkspaceTool('@playwright/test'),browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[],errors=[],warnings=[],flat=node=>[node,...(node.children??[]).flatMap(flat)];
try{
 const context=await browser.newContext({viewport:{width:1100,height:1800},serviceWorkers:'block',reducedMotion:'reduce'});await context.route('**/*',route=>['file:','data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():(errors.push('EXTERNAL_NETWORK'),route.abort()));const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
 for(const item of report.results){
  if(!item.delivery){results.push({id:item.id,status:'NOT_EVALUATED_NO_DELIVERY',originalStatus:item.status});continue;}
  const bundle=await readJson(resolve(input,item.id,'panel.bundle.json'));assert.equal(bundle.compilerVersion,report.cohort==='readable-layout-v1'?'0.39.0':report.cohort==='readable-heading-v1'?'0.38.0':'0.37.0');const nodes=flat(bundle.componentBundle.document.root),views=[];
  for(const viewport of [{width:1100,height:1800},{width:390,height:844},{width:375,height:812}]){
   await page.setViewportSize(viewport);const path=pathToFileURL(resolve(input,item.id,'delivery/pixi/index.html')).href;await page.goto(path);assert.equal(page.url(),path);assert.equal(await page.title(),'面板交付预览');await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status')?.dataset.state));assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),bundle.state);
   for(const tab of bundle.spec.tabs?.pages??[null]){
    if(tab)await page.evaluate(({bind,id})=>window.panelDelivery.panel.setState({...window.panelDelivery.getState(),[bind]:id}),{bind:bundle.spec.tabs.bind,id:tab.id});
    const inspection=await page.evaluate(()=>window.panelDelivery.inspect()),visible=new Set(inspection.nodes.filter(node=>node.visible).map(node=>node.id)),box=await page.locator('canvas').boundingBox(),scale=box.width/bundle.spec.canvas.width;
    const fonts=nodes.filter(node=>node.type==='Text'&&node.props.text&&node.id!==bundle.spec.id+'.title'&&visible.has(node.id)).map(node=>({id:node.id,fontSize:node.props.style.fontSize,cssFontSize:node.props.style.fontSize*scale}));assert(fonts.length>0);
    const minimum=Math.min(...fonts.map(font=>font.cssFontSize)),overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),name=item.id+'-'+viewport.width+'-'+(tab?.id??'body')+'.png';await page.locator('canvas').screenshot({path:resolve(output,name)});
    views.push({viewport,page:tab?.id??null,status:minimum>=16&&!overflow?'PASS':'FAIL',minimumCssFontSize:minimum,requiredCssFontSize:16,canvasScale:scale,canvasCssWidth:box.width,fonts,horizontalOverflow:overflow,capture:{path:name,sha256:await digestBytes(await readFile(resolve(output,name)))}});
   }
  }
  const status=views.every(view=>view.status==='PASS')?'PASS':'FAIL';results.push({id:item.id,status,panelSha256:bundle.sha256,views});console.log(JSON.stringify({id:item.id,status,minimumCssFontSize:Math.min(...views.map(view=>view.minimumCssFontSize))}));
 }
 const status=errors.length===0&&results.every(item=>item.status==='PASS')?'PASS':'FAIL';await writeNewJson(output,'readability-report.json',{kind:'NATIVE_ORIGINAL_READABILITY_NOT_CONTENT_CERTIFICATION',sourceKind:report.kind??'REAL_MODEL_BATCH',sourceRealModelCalls:report.realModelCalls,status,planSha256:report.planSha256,results,errors,warnings,realModelCalls:0,browserPath:'Browser plugin not available; local Playwright/Edge',unityNative:'NOT_RUN'});if(status!=='PASS')process.exitCode=1;
}finally{await browser.close();}
