// Offline Studio verification for a no-overflow ScrollView; never sets its value.
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
 assert.equal(node.type,'ScrollView');assert.equal(node.props.scrollbarVisibility,'always');assert.equal(node.props.contentHeight,node.layout.height);assert.equal(node.props.contentWidth,node.layout.width);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();
 const snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 const initial=await snapshot();const bounds=initial.inspection.nodes.find(n=>n.id===id).bounds;
 const a=node.props.appearance,track=a.scrollbarTrack.layout,scale=node.layout.height/a.sourceCanvas.height;
 const regions=initial.inspection.paintRegions.filter(r=>r.componentId===id).map(r=>r.bounds);
 assert.deepEqual(regions,[{x:bounds.x+track.x*scale,y:bounds.y+track.y*scale,width:track.width*scale,height:track.height*scale},{x:bounds.x+a.scrollbarThumbPositions.min.x*scale,y:bounds.y+track.y*scale,width:a.scrollbarThumbCanvas.width*scale,height:track.height*scale}]);
 const at=async(x,y)=>{const b=await canvas.boundingBox();return[b.x+x*b.width/bundle.document.canvas.width,b.y+y*b.height/bundle.document.canvas.height];};
 const results=[];
 async function check(input){await page.waitForTimeout(150);const s=await snapshot();const n=s.inspection.nodes.find(n=>n.id===id);assert.deepEqual(n.value,{x:0,y:0});assert.equal(s.events.filter(e=>e.id===id&&e.type==='scroll').length,0);results.push({input,value:n.value,events:s.events.filter(e=>e.id===id)});}
 await check('initial');
 await canvas.screenshot({path:resolve(out,'canvas-before.png')});await page.screenshot({path:resolve(out,'studio.png'),fullPage:true});
 const tx=bounds.x+(track.x+track.width/2)*scale,ty=bounds.y+(track.y+track.height/2)*scale;
 await page.mouse.move(...await at(tx,ty));await page.mouse.wheel(0,1200);await check('track-wheel-down');
 await page.mouse.wheel(0,-1200);await check('track-wheel-up');
 await page.mouse.move(...await at(bounds.x+50,bounds.y+50));await page.mouse.wheel(500,1200);await check('viewport-wheel');
 for(const delta of [-700,700]){await page.mouse.move(...await at(tx,ty));await page.mouse.down();await page.mouse.move(...await at(tx,ty+delta),{steps:10});await page.mouse.up();await check('thumb-drag-'+delta);}
 await page.mouse.click(...await at(tx,ty));
 let focused=false;for(let i=0;i<40;i++){await page.keyboard.press('Tab');const s=await snapshot();if(s.events.filter(e=>e.type==='focus').at(-1)?.id===id){focused=true;break;}}
 assert.equal(focused,true,'keyboard focus must reach the ScrollView');
 await page.keyboard.press('End');await check('keyboard-End');await page.keyboard.press('Home');await check('keyboard-Home');
 await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
 await canvas.screenshot({path:resolve(out,'canvas-after.png')});
 const final=await snapshot();assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'report.json'),JSON.stringify({kind:'scroll_studio_no_overflow_v1',zipSha256:hash(await readFile(zip)),status:'passed',componentId:id,bounds,track,sourceThumbCanvas:a.scrollbarThumbCanvas,expectedRenderedThumb:{x:bounds.x+a.scrollbarThumbPositions.min.x*scale,y:bounds.y+track.y*scale,width:a.scrollbarThumbCanvas.width*scale,height:track.height*scale,travel:0},results,initial,final,errors,human_visual_acceptance:false},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
