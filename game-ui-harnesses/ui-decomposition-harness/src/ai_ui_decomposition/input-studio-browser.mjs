// Actual Studio Input/RadioGroup verification; no setValue or provider calls.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [rootArg,zipArg,outArg,id]=process.argv.slice(2);
const root=resolve(rootArg),zip=resolve(zipArg),out=resolve(outArg);
await mkdir(out,{recursive:false});
const {chromium}=await import(pathToFileURL(resolve(root,'node_modules/playwright/index.mjs')));
const dist=resolve(root,'dist'),hash=b=>createHash('sha256').update(b).digest('hex');
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');const path=resolve(dist,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 if(!path.startsWith(dist+sep))throw Error('path');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({channel:process.env.UI_HARNESS_BROWSER||'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:2200,height:1600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.locator('#open-handoff').setInputFiles(zip);
 await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const bundle=await page.evaluate(()=>window.uiStudio.exportSelected());
 const walk=n=>[n,...(n.children||[]).flatMap(walk)];const nodes=walk(bundle.document.root);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();
 const snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 const at=async(x,y)=>{const b=await canvas.boundingBox();return[b.x+x*b.width/bundle.document.canvas.width,b.y+y*b.height/bundle.document.canvas.height];};
 const initial=await snapshot();const results=[];
 await canvas.screenshot({path:resolve(out,'initial.png')});await page.screenshot({path:resolve(out,'studio.png'),fullPage:true});
 for(const node of nodes.filter(n=>n.type==='Input')){
  const bound=initial.inspection.nodes.find(n=>n.id===node.id).bounds;
  await page.mouse.click(...await at(bound.x+bound.width/2,bound.y+bound.height/2));await page.keyboard.press('Control+A');await page.keyboard.type('QA');await page.waitForTimeout(120);
  let s=await snapshot(),n=s.inspection.nodes.find(n=>n.id===node.id);assert.equal(n.value,'QA');assert.ok(s.events.some(e=>e.id===node.id&&['input','change'].includes(e.type)));
  assert.ok(n.renderedTextBounds.some(l=>l.text==='QA'));await canvas.screenshot({path:resolve(out,node.id+'-edited.png')});results.push({componentId:node.id,input:'mouse-focus and real keyboard QA',value:n.value,labels:n.renderedTextBounds,events:s.events.filter(e=>e.id===node.id)});
  await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');s=await snapshot();assert.equal(s.inspection.nodes.find(n=>n.id===node.id).value,'');results.push({componentId:node.id,input:'real keyboard clear',value:''});
 }
 for(const node of nodes.filter(n=>n.type==='RadioGroup')){
  const bounds=initial.inspection.nodes.find(n=>n.id===node.id).bounds;
  for(const item of node.props.appearance.items){const r=item.hitArea;await page.mouse.click(...await at(bounds.x+r.x+r.width/2,bounds.y+r.y+r.height/2));await page.waitForTimeout(120);const s=await snapshot(),n=s.inspection.nodes.find(n=>n.id===node.id);assert.equal(n.value,item.optionId);assert.ok(s.events.some(e=>e.id===node.id&&e.type==='change'&&e.value===item.optionId));await canvas.screenshot({path:resolve(out,node.id+'-'+item.optionId+'.png')});results.push({componentId:node.id,input:'real mouse '+item.optionId,value:n.value,events:s.events.filter(e=>e.id===node.id)});}
 }
 const final=await snapshot();assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'report.json'),JSON.stringify({kind:'input_radio_studio_v1',zipSha256:hash(await readFile(zip)),status:'passed',results,initial,final,errors,human_visual_acceptance:false},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
