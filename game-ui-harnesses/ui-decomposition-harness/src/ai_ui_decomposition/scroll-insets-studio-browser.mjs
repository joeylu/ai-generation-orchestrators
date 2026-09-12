// Real Studio wheel, drag and keyboard verification for explicit inset ScrollViews.
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
 const walk=n=>[n,...(n.children||[]).flatMap(walk)];const node=walk(bundle.document.root).find(n=>n.id===id);
 assert.equal(node.type,'ScrollView');assert.equal(node.props.scrollbarVisibility,'always');
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();
 const snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 const initial=await snapshot(),bounds=initial.inspection.nodes.find(n=>n.id===id).bounds;
 const a=node.props.appearance,track=a.scrollbarTrack.layout,scale=node.layout.height/a.sourceCanvas.height;
 assert.equal(scale,1);assert.ok(a.scrollbarInsets);
 const max=Math.max(0,node.props.contentHeight-node.layout.height),usable=track.height-a.scrollbarInsets.top-a.scrollbarInsets.bottom;
 const height=Math.min(usable,Math.max(a.scrollbarThumbCanvas.height,usable*node.layout.height/node.props.contentHeight)),travel=usable-height;
 const at=async(x,y)=>{const b=await canvas.boundingBox();return[b.x+x*b.width/bundle.document.canvas.width,b.y+y*b.height/bundle.document.canvas.height];};
 const tx=bounds.x+a.scrollbarThumbPositions.min.x+a.scrollbarThumbCanvas.width/2,top=bounds.y+track.y+a.scrollbarInsets.top;
 const results=[];const events=s=>s.events.filter(e=>e.id===id&&e.type==='scroll');
 async function check(input,expected,previous,changed){await page.waitForTimeout(160);const s=await snapshot(),n=s.inspection.nodes.find(n=>n.id===id);
  assert.ok(Number.isFinite(n.value.y)&&Math.abs(n.value.y-expected)<.1,input+': '+JSON.stringify(n.value));assert.equal(n.value.x,0);
  const thumb=s.inspection.paintRegions.filter(r=>r.componentId===id).at(-1).bounds;
  assert.ok(Math.abs(thumb.y-(top+(max?expected/max:0)*travel))<.1);assert.ok(Math.abs(thumb.height-height)<.1);
  assert.ok(thumb.y>=top-.01&&thumb.y+thumb.height<=top+usable+.01);
  if(previous){assert.equal(events(s).length>events(previous).length,changed,input+' events');}
  const child=initial.inspection.nodes.find(n=>n.parentId===id)||initial.inspection.nodes.find(n=>n.id==='inventory-list');
  if(child){const after=s.inspection.nodes.find(n=>n.id===child.id);assert.ok(Math.abs(after.bounds.y-child.bounds.y+expected)<.1,'visible child translation');}
  results.push({input,value:n.value,scrollEvents:events(s),thumb});return s;
 }
 async function shot(name){await canvas.screenshot({path:resolve(out,name+'.png')});}
 let current=await check('initial',0);await shot('top');await page.screenshot({path:resolve(out,'studio.png'),fullPage:true});
 await page.mouse.move(...await at(bounds.x+40,bounds.y+50));await page.mouse.wheel(0,max/2||10);current=await check('wheel-middle',max/2,current,max>0);await shot('middle');
 await page.mouse.wheel(0,1200);current=await check('wheel-bottom',max,current,max>0);await shot('bottom');
 await page.mouse.wheel(0,1200);current=await check('wheel-clamp',max,current,false);
 await page.mouse.move(...await at(tx,top+height/2+travel));await page.mouse.down();await page.mouse.move(...await at(tx,top+height/2-40),{steps:8});await page.mouse.up();current=await check('drag-top',0,current,max>0);
 await page.mouse.move(...await at(tx,top+height/2));await page.mouse.down();await page.mouse.move(...await at(tx,top+height/2+travel+40),{steps:8});await page.mouse.up();current=await check('drag-bottom',max,current,max>0);
 await page.mouse.click(...await at(tx,top+height/2));
 let focused=false;for(let i=0;i<80;i++){await page.keyboard.press('Tab');const s=await snapshot();if(s.events.filter(e=>e.type==='focus').at(-1)?.id===id){focused=true;break;}}
 assert.equal(focused,true);current=await snapshot();
 const beforeHome=current.inspection.nodes.find(n=>n.id===id).value.y;
 await page.keyboard.press('Home');current=await check('keyboard-Home',0,current,beforeHome!==0);
 await page.keyboard.press('Home');current=await check('keyboard-Home-clamp',0,current,false);
 await page.keyboard.press('End');current=await check('keyboard-End',max,current,max>0);
 await page.keyboard.press('End');current=await check('keyboard-End-clamp',max,current,false);
 await page.keyboard.press('ArrowUp');current=await check('keyboard-ArrowUp',Math.max(0,max-40),current,max>0);
 await page.keyboard.press('ArrowDown');current=await check('keyboard-ArrowDown',max,current,max>0);
 assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'report.json'),JSON.stringify({kind:'scroll_studio_insets_v1',zipSha256:hash(await readFile(zip)),status:'passed',componentId:id,bounds,insets:a.scrollbarInsets,usableHeight:usable,contentHeight:node.props.contentHeight,viewportHeight:node.layout.height,maxScrollY:max,thumbHeight:height,travelY:travel,results,initial,final:current,errors,human_visual_acceptance:false},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
