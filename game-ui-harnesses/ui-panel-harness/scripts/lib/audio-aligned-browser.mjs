import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './workspace-tools.mjs';
import {writeNewJson} from '../../src/io.mjs';
const close=(a,b,message)=>assert(Math.abs(a-b)<.1,`${message}: ${a} / ${b}`);
function aligned(inspection,bundle){
  const nodes=new Map(inspection.nodes.map(node=>[node.id,node])),id=bundle.spec.id;
  const volume=nodes.get(id+'.row.volume-row.control'),music=nodes.get(id+'.row.music-row.control'),railLeft=volume.bounds.x+18,railRight=volume.bounds.x+volume.bounds.width-18;
  for(const row of ['volume-row','music-row']){
    const label=nodes.get(`${id}.row.${row}.label`),value=nodes.get(`${id}.row.${row}.value`),slider=nodes.get(`${id}.row.${row}.control`),glyph=value.renderedTextBounds[0].bounds;
    close(label.bounds.x,railLeft,'label / rail start');close(slider.bounds.x+18,railLeft,'rail start');close(slider.bounds.x+slider.bounds.width-18,railRight,'rail end');close(glyph.x+glyph.width,railRight,'value glyph / rail end');
    close(slider.bounds.height,44,'slider touch height');
  }
  const toggle=nodes.get(id+'.row.mute-row.control'),save=nodes.get(id+'.row.save.control');
  close(toggle.bounds.x+(toggle.bounds.width+52)/2,railRight,'switch capsule / rail end');close(save.bounds.x+save.bounds.width,railRight,'save / rail end');
  close(nodes.get(id+'.row.mute-row.label').bounds.x,railLeft,'switch label');
  assert.equal([...nodes.keys()].filter(key=>key.includes('.divider.')).length,1);
  close(nodes.get(id+'.panel').bounds.height,420,'panel height');close(music.bounds.y-volume.bounds.y,88,'slider row spacing');
  for(const node of nodes.values())for(const text of node.renderedTextBounds??[])assert(!text.implicitTruncation);
  return{railLeft,railRight,panelHeight:nodes.get(id+'.panel').bounds.height};
}
export async function checkAudioAlignment(output,entries){
  const report={status:'FAIL',checks:[],evidence:[]},errors=[],requests=[];let browser,page;
  const {chromium}=await loadWorkspaceTool('@playwright/test');
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    for(const width of [1260,390])for(const [key,entry] of Object.entries(entries)){
      await page.setViewportSize({width,height:1000});await page.goto(pathToFileURL(resolve(output,'index.html')).href+`?panel=${key}`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
      report.evidence.push({key,width,...aligned(await page.evaluate(()=>window.applePanelReview.get('after').inspect()),entry.after)});
      report.checks.push(`${key} ${width}px: shared label/rail start and measured value/switch/save right edge, one separator, 420px panel`);
      const count=await page.evaluate(()=>window.applePanelReview.events().length);
      for(const value of [0,9,70,100,0,100,70]){
        await page.evaluate(value=>{const panel=window.applePanelReview.get('after');panel.setState({...panel.getState(),volume:value,music:100-value});},value);
        aligned(await page.evaluate(()=>window.applePanelReview.get('after').inspect()),entry.after);
      }
      assert.equal(await page.evaluate(()=>window.applePanelReview.events().length),count);
      assert.deepEqual(await page.evaluate(()=>window.applePanelReview.get('before').getState()),entry.before.state);
      report.checks.push(`${key} ${width}px: 0/9/70/100% remain aligned after repeated silent host updates; source state independent`);
      const node=(await page.evaluate(()=>window.applePanelReview.get('after').inspect())).nodes.find(node=>node.id===entry.after.spec.id+'.row.volume-row.control');
      await page.locator('#after canvas').scrollIntoViewIfNeeded();const box=await page.locator('#after canvas').boundingBox(),scale=box.width/entry.after.spec.canvas.width;
      const point=value=>({x:box.x+(node.bounds.x+18+(node.bounds.width-36)*value)*scale,y:box.y+(node.bounds.y+22)*scale});
      const start=point(.5);await page.mouse.move(start.x,start.y);await page.mouse.down();
      for(const value of [.01,.09,.7,1]){const p=point(value);await page.mouse.move(p.x,p.y);aligned(await page.evaluate(()=>window.applePanelReview.get('after').inspect()),entry.after);}
      await page.mouse.up();aligned(await page.evaluate(()=>window.applePanelReview.get('after').inspect()),entry.after);
      report.checks.push(`${key} ${width}px: value glyph remains right aligned during live drag before commit`);
    }
    for(const [key,entry] of Object.entries(entries)){
      await page.goto(pathToFileURL(resolve(output,`offline-${key}/pixi/index.html`)).href);await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');
      aligned(await page.evaluate(()=>window.panelDelivery.inspect()),entry.after);
      for(const value of [0,9,100]){await page.evaluate(value=>{const app=window.panelDelivery;app.setState({...app.getState(),volume:value});},value);aligned(await page.evaluate(()=>window.panelDelivery.inspect()),entry.after);}
      await page.evaluate(async()=>{const app=window.panelDelivery;app.panel.close();await app.panel.open();});aligned(await page.evaluate(()=>window.panelDelivery.inspect()),entry.after);
      assert.equal(await page.evaluate(()=>window.panelDelivery.getState().volume),100);
      report.checks.push(`${key}: downloaded ZIP offline alignment, host updates and close/reopen retain 100%`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);report.status='PASS';report.browserErrors=errors;report.externalRequests=requests.length;
  }catch(error){report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'alignment-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await browser?.close();await writeNewJson(output,'alignment-report.json',report);}
  if(report.status!=='PASS'){const error=new Error('AUDIO_ALIGNMENT_GATE_FAILED');error.report=report;throw error;}return report;
}
