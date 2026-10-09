import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './workspace-tools.mjs';
import {writeNewJson} from '../../src/io.mjs';
const close=(a,b,message)=>assert(Math.abs(a-b)<.1,`${message}: ${a} / ${b}`);
function inspectLayout(inspection,entry){
  const nodes=new Map(inspection.nodes.map(node=>[node.id,node])),id=entry.after.spec.id,panel=nodes.get(id+'.panel'),title=nodes.get(id+'.title');
  const left=panel.bounds.x+28,right=panel.bounds.x+panel.bounds.width-28;
  close(title.renderedTextBounds[0].bounds.x,left,'title / content left');
  const rows=entry.after.spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='button');
  const controls=rows.map(row=>nodes.get(`${id}.row.${row.id}.control`));
  for(const button of controls){close(button.bounds.height,44,'button hit height');for(const text of button.renderedTextBounds??[])assert(!text.implicitTruncation);}
  if(entry.id==='pause'){
    close(panel.bounds.height,296,'pause height');
    for(const button of controls){close(button.bounds.x,left,'button left');close(button.bounds.x+button.bounds.width,right,'button right');}
    for(let index=1;index<controls.length;index++)assert(controls[index].bounds.y-controls[index-1].bounds.y-controls[index-1].bounds.height>=8);
  }else{
    close(panel.bounds.height,244,'exit height');
    const question=nodes.get(id+'.row.message.label');assert(question.renderedTextBounds.some(text=>text.text===entry.before.spec.sections[0].rows[0].text.split('\n')[0]));
    const copy=nodes.get(id+'.row.message.control');close(copy.bounds.x,left,'copy / title left');
    const cancel=controls[0],confirm=controls[1];close(cancel.bounds.y,confirm.bounds.y,'same footer baseline');close(confirm.bounds.x+confirm.bounds.width,right,'footer / content right');
    close(cancel.bounds.width,76,'cancel width');close(confirm.bounds.width,112,'confirm width');assert(confirm.bounds.x-cancel.bounds.x-cancel.bounds.width>=8);
    const lines=[...nodes.values()].filter(node=>node.id===copy.id||node.id.startsWith(copy.id+'.line'));
    assert.equal(lines.length,1,'detail remains one full line beneath the question');for(const line of [question,...lines])for(const text of line.renderedTextBounds??[])assert(!text.implicitTruncation);
  }
  return{left,right,panelHeight:panel.bounds.height};
}
export async function checkCompactActions(output,entries){
  const report={status:'FAIL',checks:[],evidence:[]},errors=[],requests=[];let browser,page;
  const {chromium}=await loadWorkspaceTool('@playwright/test');
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage();
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    const open=async key=>{await page.goto(pathToFileURL(resolve(output,'index.html')).href+`?panel=${key}`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');};
    for(const width of [1260,390]){
      await page.setViewportSize({width,height:1000});
      for(const [key,entry] of Object.entries(entries)){
        await open(key);report.evidence.push({key,width,...inspectLayout(await page.evaluate(()=>window.applePanelReview.get('after').inspect()),entry)});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        report.checks.push(`${key} ${width}px: title/content/footer alignment, compact height, 44px buttons and original copy without truncation`);
      }
      await open('pause-dark');await page.locator('[data-purpose="exit"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert(page.url().endsWith('?panel=exit-dark'));
      await page.locator('[data-mode="light"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert(page.url().endsWith('?panel=exit-light'));
      assert((await page.locator('#audio-reference').getAttribute('href')).endsWith('?panel=audio-light'));
      report.checks.push(`${width}px: type/mode navigation and matching audio reference`);
    }
    for(const [key,entry] of Object.entries(entries)){
      await page.goto(pathToFileURL(resolve(output,`offline-${key}/pixi/index.html`)).href);await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');
      inspectLayout(await page.evaluate(()=>window.panelDelivery.inspect()),entry);report.checks.push(`${key}: actual downloaded ZIP retains layout offline`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);report.status='PASS';report.browserErrors=errors;report.externalRequests=requests.length;
  }catch(error){report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'compact-actions-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await browser?.close();await writeNewJson(output,'compact-actions-report.json',report);}
  if(report.status!=='PASS'){const error=new Error('COMPACT_ACTIONS_GATE_FAILED');error.report=report;throw error;}return report;
}
