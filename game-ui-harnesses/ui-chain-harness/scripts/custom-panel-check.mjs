// Offline browser acceptance of examples/custom-panel.json; never invokes a model.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {hash} from '../src/skins/package.mjs';
const directory=resolve(process.argv[2]),out=resolve(process.argv[3]??join(tmpdir(),'ui-chain-custom-panel-check'));
const report=JSON.parse(await readFile(join(directory,'report.json'))),html=await readFile(join(directory,'preview.html'));
assert.equal(hash(html),report.files.find(f=>f.file==='preview.html').sha256);assert.equal(report.source,'offline-fixtures');
await mkdir(out,{recursive:true});const checks=[],errors=[];
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1500},serviceWorkers:'block'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url()==='http://127.0.0.1/custom-panel-check'?r.fulfill({body:html,contentType:'text/html'}):r.abort());
 await page.goto('http://127.0.0.1/custom-panel-check');await page.waitForFunction(()=>window.actionPreview);
 const reveal=async id=>page.evaluate(id=>{const r=actionPreview.scene.runtime,s=r.handles.get('custom-scroll');if(!s||['row7','row8'].includes(id))return;const b=s.adapter.box.getBounds(),target=r.handles.get(id).root.getBounds(),offset=s.readState().initialOffsetY,max=Math.max(0,s.adapter.box.contentHeight-s.adapter.box.height);s.setState({initialOffsetY:Math.min(max,Math.max(0,offset+target.y-b.y-8))});r.flush();},id);
 const point=async(id,row)=>page.evaluate(({id,row})=>{const h=actionPreview,r=h.scene.runtime;r.flush();const v=row===undefined?r.handles.get(id).adapter.view:r.handles.get(id).adapter.view.rows[row],b=v.getBounds(),c=h.app.canvas.getBoundingClientRect();return{x:c.left+(b.x+b.width/2)*c.width/h.app.screen.width,y:c.top+(b.y+b.height/2)*c.height/h.app.screen.height};},{id,row});
 const click=async(id,row)=>{if(row===undefined)await reveal(id);const q=await point(id,row);await page.mouse.click(q.x,q.y);};
 for(const orientation of ['landscape','portrait']){
  await page.locator(orientation==='landscape'?'#wide':'#tall').click();
  const nodes=await page.evaluate(()=>actionPreview.exportValue().document.nodes);assert(nodes.some(n=>n.id==='custom-scroll'));assert(nodes.some(n=>n.id==='row6'&&n.recipeRef==='progress-bar@1.0.0'));checks.push(orientation+': mixed component render');
  await click('row1');await page.locator('input').fill('新玩家');await page.locator('input').press('Enter');assert.equal(await page.evaluate(()=>actionPreview.state.row1.value),'新玩家');checks.push(orientation+': native input');
  await click('row3');assert.equal(await page.evaluate(()=>actionPreview.state.row3.checked),false);checks.push(orientation+': switch');
  await reveal('row4');const drag=await page.evaluate(()=>{const p=actionPreview,v=p.scene.runtime.handles.get('row4').adapter.view,c=p.app.canvas.getBoundingClientRect(),toScreen=q=>({x:c.left+q.x*c.width/p.app.screen.width,y:c.top+q.y*c.height/p.app.screen.height});return {start:toScreen(v.bg.toGlobal({x:v.bg.width*(v.value-v.min)/(v.max-v.min),y:v.bg.height/2})),end:toScreen(v.bg.toGlobal({x:v.bg.width+1,y:v.bg.height/2}))};});await page.mouse.move(drag.start.x,drag.start.y);await page.mouse.down();await page.mouse.move(drag.end.x,drag.end.y,{steps:8});await page.mouse.up();assert.equal(await page.evaluate(()=>actionPreview.state.row4.value),100);checks.push(orientation+': pointer slider drag');
  await click('row5');await click('row5',1);assert.equal(await page.evaluate(()=>actionPreview.state.row5.selectedId),'option1');checks.push(orientation+': dropdown');
  await click('row8');const submit=await page.evaluate(()=>actionPreview.lastResult);assert.equal(submit.event.action,'submit');assert.equal(submit.event.values.row3.checked,false);assert.equal(submit.event.values.row4.value,100);checks.push(orientation+': local submit');
  await click('row7');const reset=await page.evaluate(()=>actionPreview.state);assert.equal(reset.row1.value,'玩家');assert.equal(reset.row3.checked,true);assert.equal(reset.row4.value,50);assert.equal(reset.row5.selectedId,'option0');checks.push(orientation+': exact reset');
  await page.evaluate(()=>{const r=actionPreview.scene.runtime;r.handles.get('custom-scroll').setState({initialOffsetY:0});r.flush();});
  if(orientation==='landscape'){const q=await point('row1');await page.mouse.move(q.x,q.y);await page.mouse.wheel(0,300);await page.waitForFunction(()=>actionPreview.scene.runtime.handles.get('custom-scroll').readState().initialOffsetY>0);checks.push('landscape: content wheel scroll');}
  await page.evaluate(()=>{const r=actionPreview.scene.runtime;r.handles.get('custom-scroll').setState({initialOffsetY:0});r.flush();});
  await page.locator('canvas').screenshot({path:join(out,orientation+'.png')});
 }
 assert.deepEqual(errors,[]);checks.push('no browser runtime errors');
 await writeFile(join(out,'checks.json'),JSON.stringify({status:'passed',checks,errors,source:'offline-fixtures',modelCalls:0,previewSha256:hash(html)},null,2));
 console.log(JSON.stringify({status:'passed',checks:checks.length,directory:out}));
}finally{await browser.close();}
