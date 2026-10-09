import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './workspace-tools.mjs';
import {digestBytes} from '../../src/canonical.mjs';
import {validatePanelBundle} from '../../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../../src/workbench-model.mjs';
import {writeNewJson} from '../../src/io.mjs';
import {readStoredZip} from '../../tests/unity-kit-helpers.mjs';

export async function checkApplePanelSamples(output,entries,core){
  const report={status:'FAIL',phase:'open',checks:[],modelCalls:0,imageGenerationCalls:0,humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN'};
  const {chromium}=await loadWorkspaceTool('@playwright/test');
  let browser,page;const errors=[],requests=[];
  const watch=target=>{target.on('pageerror',error=>errors.push(error.message));target.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});};
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    page=await browser.newPage({viewport:{width:1260,height:1000},acceptDownloads:true});watch(page);
    const open=async key=>{
      await page.goto(pathToFileURL(resolve(output,'index.html')).href+`?panel=${key}`);
      await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
      assert.equal(await page.locator('canvas').count(),2);
      await page.waitForFunction(()=>['before','after'].every(id=>{const stage=document.getElementById(id).getBoundingClientRect(),canvas=document.querySelector(`#${id} canvas`).getBoundingClientRect();return canvas.width>10&&canvas.width<=stage.width+1;}));
    };
    const inspect=id=>page.evaluate(id=>window.applePanelReview.get(id).inspect(),id);
    const state=id=>page.evaluate(id=>window.applePanelReview.get(id).getState(),id);
    const noTruncation=async id=>{
      const nodes=(await inspect(id)).nodes.filter(node=>node.visible);
      for(const node of nodes)for(const text of node.renderedTextBounds??[])assert(!text.implicitTruncation,`${node.id}: truncated text`);
      return nodes;
    };
    const point=async(bundle,row,fraction=.5)=>{
      await page.locator('#after canvas').scrollIntoViewIfNeeded();
      const node=(await inspect('after')).nodes.find(node=>node.id===`${bundle.spec.id}.row.${row}.control`);assert(node,`Missing control ${row}`);
      const box=await page.locator('#after canvas').boundingBox(),factor=box.width/bundle.spec.canvas.width;
      return{x:box.x+(node.bounds.x+node.bounds.width*fraction)*factor,y:box.y+(node.bounds.y+node.bounds.height/2)*factor,node,box,factor};
    };
    const click=async(bundle,row,fraction=.5)=>{const p=await point(bundle,row,fraction);await page.mouse.click(p.x,p.y);return p;};
    const exercise=async(key,narrow=false)=>{
      const bundle=entries[key].after,rows=bundle.spec.sections.flatMap(section=>section.rows);
      for(const row of rows.filter(row=>row.kind==='slider')){
        const field=bundle.spec.state.find(field=>field.id===row.bind);
        await click(bundle,row.id,.01);assert.equal((await state('after'))[row.bind],field.min);
        await click(bundle,row.id,.99);assert.equal((await state('after'))[row.bind],field.max);
        await click(bundle,row.id,.5);const middle=(await state('after'))[row.bind];assert(middle>field.min&&middle<field.max);
        const start=await point(bundle,row.id,.5),end=await point(bundle,row.id,.8);
        await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();assert((await state('after'))[row.bind]>middle);
      }
      for(const row of rows.filter(row=>row.kind==='switch')){await click(bundle,row.id);assert.equal((await state('after'))[row.bind],!bundle.state[row.bind]);}
      for(const row of rows.filter(row=>row.kind==='select')){
        const p=await click(bundle,row.id);
        await page.mouse.click(p.x,p.box.y+(p.node.bounds.y+p.node.bounds.height+2+20)*p.factor);
        assert.equal((await state('after'))[row.bind],bundle.spec.state.find(field=>field.id===row.bind).options[0].id);
      }
      if(bundle.spec.state.some(field=>field.type==='progress')){
        const count=(await page.evaluate(()=>window.applePanelReview.events())).length;
        await page.evaluate(()=>window.applePanelReview.get('after').setProgress('experience',85));assert.equal((await state('after')).experience,85);
        assert.equal((await page.evaluate(()=>window.applePanelReview.events())).length,count);
        assert((await inspect('after')).nodes.find(node=>node.id===`${bundle.spec.id}.row.experience-row.value`).renderedTextBounds.some(text=>text.text==='85%'));
      }
      const exported=await page.evaluate(()=>window.applePanelReview.get('after').exportBundle());await validatePanelBundle(exported,core);
      assert.deepEqual(await state('before'),entries[key].before.state);
      for(const row of rows.filter(row=>row.kind==='button'))await click(bundle,row.id);
      const events=await page.evaluate(()=>window.applePanelReview.events().filter(event=>event.instanceId==='after'));
      for(const row of rows.filter(row=>row.kind!=='text'&&row.kind!=='progress'))assert(events.some(event=>event.event.name===row.event),`${key}: missing ${row.event}`);
      if(rows.some(row=>row.action?.kind==='reset-initial'))assert.deepEqual(await state('after'),bundle.state);
      await page.evaluate(state=>window.applePanelReview.get('after').setState(state),bundle.state);
      assert.deepEqual(await page.evaluate(()=>window.applePanelReview.errors()),[]);
      report.checks.push(`${key}: ${narrow?'390px':'desktop'} buttons/events, controls, independent state and strict live export`);
    };
    for(const [key,entry] of Object.entries(entries)){
      report.phase=`${key}-desktop`;await open(key);
      await noTruncation('before');await noTruncation('after');
      await page.locator('#after-stage').screenshot({path:resolve(output,`${key}.png`)});await page.screenshot({path:resolve(output,`${key}-comparison.png`),fullPage:true});
      report.checks.push(`${key}: desktop pair mounted, no truncation and saved comparison`);
      await exercise(key);
      report.phase=`${key}-download`;
      const pending=page.waitForEvent('download');await page.locator('#download').click();const download=await pending;
      const downloaded=resolve(output,`downloaded-${key}.zip`);await download.saveAs(downloaded);
      const zip=readStoredZip(await readFile(downloaded)),manifest=JSON.parse(new TextDecoder().decode(zip.get('delivery-manifest.json')));
      for(const file of manifest.files){assert.equal(zip.get(file.path).length,file.bytes);assert.equal(await digestBytes(zip.get(file.path)),file.sha256);}
      const reopened=await validatePanelBundle(JSON.parse(new TextDecoder().decode(zip.get('pixi/panel.bundle.json'))),core);assert.equal(reopened.sha256,entry.after.sha256);
      const model=await createWorkbenchModel({catalog:reopened.catalog,pool:null},core);await model.importPanel(reopened);const reexported=await model.exportPanel();assert.equal(reexported.sha256,reopened.sha256);model.dispose();
      const offline=resolve(output,`offline-${key}`);
      for(const [path,bytes] of zip){const file=resolve(offline,path),rel=relative(offline,file);assert(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../'));await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
      const offlinePage=await browser.newPage();watch(offlinePage);await offlinePage.goto(pathToFileURL(resolve(offline,'pixi/index.html')).href);
      await offlinePage.waitForFunction(()=>document.getElementById('status')?.dataset.state);assert.equal(await offlinePage.locator('#status').getAttribute('data-state'),'ready');
      assert.deepEqual(await offlinePage.evaluate(()=>window.panelDelivery.getState()),entry.after.state);assert.equal(await offlinePage.locator('canvas').count(),1);await offlinePage.close();
      report.checks.push(`${key}: actual ZIP download CRC/checksums, library-free Studio reimport/reexport and offline open`);
    }
    await page.setViewportSize({width:390,height:844});
    for(const key of Object.keys(entries)){
      report.phase=`${key}-narrow`;await open(key);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await noTruncation('before');await noTruncation('after');await exercise(key,true);await page.screenshot({path:resolve(output,`${key}-narrow.png`),fullPage:true});
      report.checks.push(`${key}: 390px navigation/containment and no truncation`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);report.status='PASS';report.phase='complete';report.externalRequests=requests.length;report.browserErrors=errors;
  }catch(error){report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});}
  finally{await browser?.close();await writeNewJson(output,'review-report.json',report);}
  if(report.status!=='PASS'){const error=new Error('APPLE_PANEL_REVIEW_GATE_FAILED');error.report=report;throw error;}return report;
}
