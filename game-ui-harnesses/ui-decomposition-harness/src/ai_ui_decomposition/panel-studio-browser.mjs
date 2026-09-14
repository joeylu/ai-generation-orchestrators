// Actual Studio static Panel verification; no synthetic Panel interaction states.
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
 const panel=nodes.find(n=>n.type==='Panel');assert.ok(panel);assert.equal(panel.props.appearance.header,undefined);assert.equal(panel.props.appearance.body,undefined);
 const visible=initial.inspection.nodes.find(n=>n.id===panel.id);assert.equal(visible.visible,true);assert.ok(visible.renderedTextBounds.some(t=>t.text===panel.props.title&&t.fontFamily==='Arial'));
 const regions=initial.inspection.paintRegions.filter(r=>r.componentId===panel.id);assert.equal(regions.filter(r=>Math.abs(r.bounds.width-visible.bounds.width)<.1&&Math.abs(r.bounds.height-visible.bounds.height)<.1).length,1,'one full frame draw');assert.equal(regions.length,2,'frame and semantic title only');
 for(const [name,x,y] of [['title',visible.bounds.x+40,visible.bounds.y+25],['body',visible.bounds.x+150,visible.bounds.y+350],['edge',visible.bounds.x+8,visible.bounds.y+250]]){
  const before=await snapshot();await page.mouse.click(...await at(x,y));await page.keyboard.press('ArrowDown');await page.keyboard.press('Space');await page.waitForTimeout(100);
  const after=await snapshot();assert.deepEqual(after.inspection.nodes.find(n=>n.id===panel.id).bounds,visible.bounds);
  assert.equal(after.events.filter(e=>e.id===panel.id&&['change','input','scroll'].includes(e.type)).length,before.events.filter(e=>e.id===panel.id&&['change','input','scroll'].includes(e.type)).length);
  results.push({input:name+' real click, ArrowDown, Space',panelBoundsStable:true,noValueEvents:true});
 }
 await writeFile(resolve(out,'studio-export.json'),JSON.stringify(await page.evaluate(()=>window.uiStudio.exportSelected()),null,2));
 const final=await snapshot();assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'report.json'),JSON.stringify({kind:'panel_studio_v1',zipSha256:hash(await readFile(zip)),status:'passed',results,initial,final,errors,human_visual_acceptance:false},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
