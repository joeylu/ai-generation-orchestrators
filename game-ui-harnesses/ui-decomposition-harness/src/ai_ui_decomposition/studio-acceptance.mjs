// Local Studio receipt. No setValue, CSS resizing, media, or remote network.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [rootArg,zipArg,outArg,budgetArg='600']=process.argv.slice(2);
const deadline=Date.now()+Number(budgetArg)*1000;
const remaining=()=>{const ms=deadline-Date.now();assert.ok(ms>0,'STUDIO_TIMEOUT');return ms;};
const root=resolve(rootArg),zip=resolve(zipArg),out=resolve(outArg),dist=resolve(root,'dist');
await mkdir(out,{recursive:false});
const hash=b=>createHash('sha256').update(b).digest('hex');
const walk=n=>[n,...(n.children??[]).flatMap(walk)];
const report={kind:'ui_studio_acceptance_v1',status:'running',human_visual_acceptance:false,checks:[],screenshots:[],errors:[],blockedNetwork:[],inputProtocol:'real mouse/wheel/keyboard; DPR1; unmodified Studio layout'};
let server,browser,page;
const timer=setTimeout(()=>{browser?.close().catch(()=>{});},Number(budgetArg)*1000);
try {
 report.handoffSha256=hash(await readFile(zip));report.distSha256=hash(await readFile(resolve(dist,'index.html')));
 const {chromium}=await import(pathToFileURL(resolve(root,'node_modules/playwright/index.mjs')));
 server=createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://127.0.0.1'),p=resolve(dist,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
  if(!p.startsWith(dist+sep))throw Error('path');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(p)]??'application/octet-stream');res.end(await readFile(p));
 }catch{res.statusCode=404;res.end();}});
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:process.env.UI_HARNESS_BROWSER||'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:2200,height:1800},deviceScaleFactor:1,acceptDownloads:true});
 page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin)return r.continue();report.blockedNetwork.push(u.origin);return r.abort();});
 await page.goto(origin);await page.locator('#open-handoff').setInputFiles(zip);await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const bundle=await page.evaluate(()=>window.uiStudio.exportSelected());
 await writeFile(resolve(out,'initial-bundle.json'),JSON.stringify(bundle));
 const nodes=walk(bundle.document.root),scrolls=nodes.filter(n=>n.type==='ScrollView');
 report.coverage={scrollIds:scrolls.map(n=>n.id),otherControls:'document/resources roundtrip only; run ai-ui-stateful for full state coverage',backgroundPixels:'not inferred from Studio screenshots'};
 const canvas=page.locator('#main-preview canvas'),snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 const get=(s,id)=>{const n=s.inspection.nodes.find(n=>n.id===id);assert.ok(n,`missing ${id}`);return n;};
 const events=(s,id)=>s.events.filter(e=>e.id===id&&e.type==='scroll');
 const shot=async name=>{const b=await canvas.screenshot({path:resolve(out,name+'.png')});report.screenshots.push({path:name+'.png',sha256:hash(b),space:'Studio CSS screenshot; not a native pixel oracle'});};
 const point=async(x,y)=>{
  await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();assert.ok(b);
  const cx=b.x+x*b.width/bundle.document.canvas.width,cy=b.y+y*b.height/bundle.document.canvas.height;
  assert.ok(cx>=0&&cy>=0&&cx<2200&&cy<1800,'INPUT_POINT_NOT_VISIBLE');
  return [cx,cy];
 };
 const focus=async id=>{await canvas.focus();for(let i=0;i<nodes.length*3+10&&(await canvas.getAttribute('data-focused-component'))!==id;i++)await page.keyboard.press('Tab');assert.equal(await canvas.getAttribute('data-focused-component'),id,'FOCUS_UNREACHABLE');};
 await shot('initial');
 for(const [index,node] of scrolls.entries()){
  const id=node.id,a=node.props.appearance;
  assert.ok(a?.scrollbarInsets,'STUDIO_PROFILE_REQUIRES_INSETS');assert.equal(node.props.scrollbarVisibility,'always','STUDIO_PROFILE_REQUIRES_ALWAYS');
  assert.ok(node.children?.length>0,'STUDIO_PROFILE_REQUIRES_CONTENT');
  const child=node.children[0],max=Math.max(0,node.props.contentHeight-node.layout.height);
  const sx=node.layout.width/a.sourceCanvas.width,sy=node.layout.height/a.sourceCanvas.height;
  const track=a.scrollbarTrack.layout,usable=(track.height-a.scrollbarInsets.top-a.scrollbarInsets.bottom)*sy;
  const height=Math.min(usable,Math.max(a.scrollbarThumbCanvas.height*sy,usable*node.layout.height/Math.max(node.props.contentHeight,node.layout.height))),travel=usable-height;
  const init=await snapshot(),bounds=get(init,id).bounds;
  assert.equal(get(init,id).value.x,0,'HORIZONTAL_SCROLL_UNSUPPORTED');
  const top=bounds.y+(track.y+a.scrollbarInsets.top)*sy,tx=bounds.x+(a.scrollbarThumbPositions.min.x+a.scrollbarThumbCanvas.width/2)*sx;
  const selection=s=>nodes.filter(n=>n.type==='List').map(n=>[n.id,get(s,n.id).value]);
  async function perform(name,expected,action){
   const before=await snapshot(),outer=await page.evaluate(()=>({x:scrollX,y:scrollY}));
   await action();await page.waitForTimeout(180);const after=await snapshot(),v=get(after,id).value,old=get(before,id).value.y;
   assert.ok(Number.isFinite(v.y)&&v.x===0&&v.y>=0&&v.y<=max,`${id} invalid scroll`);
   assert.ok(Math.abs(v.y-expected)<.15,`${name}: expected ${expected}, actual ${v.y}`);
   assert.deepEqual(selection(after),selection(before),'SCROLL_LIST_MISSELECTION');
   assert.deepEqual(await page.evaluate(()=>({x:scrollX,y:scrollY})),outer,'SCROLL_OUTER_PAGE_MOVED');
   const own=events(after,id).slice(events(before,id).length);
   if(Math.abs(old-expected)<.15)assert.equal(own.length,0,'DUPLICATE_BOUNDARY_EVENTS');else assert.ok(own.length>0,'MISSING_SCROLL_EVENT');
   let last=old;for(const e of own){assert.ok(Number.isFinite(e.value.y)&&e.value.y>=0&&e.value.y<=max);assert.notEqual(e.value.y,last,'DUPLICATE_SCROLL_EVENT');last=e.value.y;}
   for(const c of node.children)assert.ok(Math.abs(get(after,c.id).bounds.y-get(before,c.id).bounds.y+v.y-old)<.15,'CONTENT_TRANSLATION');
   const thumb=after.inspection.paintRegions.filter(p=>p.componentId===id).at(-1).bounds;
   assert.ok(Math.abs(thumb.height-height)<.15&&Math.abs(thumb.y-(top+(max?v.y/max:0)*travel))<.15,'THUMB_GEOMETRY');
   assert.ok(thumb.y>=top-.15&&thumb.y+thumb.height<=top+usable+.15,'THUMB_CAP_OVERLAP');
   report.checks.push({componentId:id,name,status:'passed',value:v,events:own,thumb,maxScrollY:max});
  }
  await canvas.scrollIntoViewIfNeeded();await focus(id);await perform('Home setup',0,()=>page.keyboard.press('Home'));await shot(`scroll-${index}-top`);
  const wp=await point(bounds.x+node.layout.width/3,bounds.y+node.layout.height/3);await page.mouse.move(...wp);
  await perform('wheel middle',max/2,()=>page.mouse.wheel(0,max/2||10));await shot(`scroll-${index}-middle`);
  await perform('wheel bottom',max,()=>page.mouse.wheel(0,Math.max(1200,max*2)));await shot(`scroll-${index}-bottom`);
  await perform('wheel bottom clamp',max,()=>page.mouse.wheel(0,1200));
  await perform('wheel top',0,()=>page.mouse.wheel(0,-Math.max(1200,max*2)));
  await perform('wheel top clamp',0,()=>page.mouse.wheel(0,-1200));
  for(const fraction of [.5,1,0]){
   const v=get(await snapshot(),id).value.y,start=await point(tx,top+height/2+(max?v/max:0)*travel),end=await point(tx,top+height/2+fraction*travel);
   await page.mouse.move(...start);await perform(`drag ${fraction}`,max*fraction,async()=>{await page.mouse.down();await page.mouse.move(...end,{steps:8});await page.mouse.up();});
  }
  await focus(id);
  for(const [key,value] of [['End',max],['End',max],['ArrowUp',Math.max(0,max-40)],['Home',0],['Home',0],['ArrowDown',Math.min(40,max)],['Home',0]])await perform(`keyboard ${key}`,value,()=>page.keyboard.press(key));
 }
 const before=await page.evaluate(()=>window.uiStudio.exportSelected());
 const [save]=await Promise.all([page.waitForEvent('download'),page.locator('#studio-export').click()]);await save.saveAs(resolve(out,'saved.json'));
 await page.reload();await page.locator('#open-bundle').setInputFiles(resolve(out,'saved.json'));await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 assert.deepEqual(await page.evaluate(()=>window.uiStudio.exportSelected()),before,'SAVE_REOPEN_CHANGED');await shot('saved-reopened');
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:120000}),page.getByRole('button',{name:'导出交付包',exact:true}).click()]);await download.saveAs(resolve(out,'roundtrip.zip'));
 const cli=spawnSync(process.execPath,[resolve(root,'scripts/cli.mjs'),'component-handoff',resolve(out,'roundtrip.zip'),'--output',resolve(out,'cli-reimport.json')],{encoding:'utf8',timeout:Math.min(90000,remaining()),windowsHide:true});
 assert.equal(cli.status,0,`CLI_REIMPORT: ${cli.stderr}`);
 const reimport=JSON.parse(await readFile(resolve(out,'cli-reimport.json'),'utf8'));assert.deepEqual(reimport.document,before.document);assert.deepEqual(reimport.resources,before.resources);
 await page.reload();await page.locator('#open-handoff').setInputFiles(resolve(out,'roundtrip.zip'));await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const after=await page.evaluate(()=>window.uiStudio.exportSelected());assert.deepEqual(after.document,before.document);assert.deepEqual(after.resources,before.resources);await shot('zip-reimport');
 report.checks.push({name:'save/reopen/export/official CLI/Studio reimport',status:'passed'});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedNetwork,[]);
 report.roundtripSha256=hash(await readFile(resolve(out,'roundtrip.zip')));report.status='passed';
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};if(page)try{await page.screenshot({path:resolve(out,'failure.png'),fullPage:true});}catch{}}
finally{clearTimeout(timer);await browser?.close();if(server)await new Promise(r=>server.close(r));await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,checks:report.checks.length}));process.exitCode=report.status==='passed'?0:1;
