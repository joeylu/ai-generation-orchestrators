// Local acceptance driver. Only the current component distribution is served.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const [componentRoot,output]=process.argv.slice(2).map(p=>resolve(p));
const {chromium}=await import(pathToFileURL(resolve(componentRoot,'node_modules/playwright/index.mjs')));
const matrix=JSON.parse(await readFile(resolve(output,'state-matrix.json'),'utf8'));
const bytes=await readFile(resolve(output,'consumed.json'));const bundle=JSON.parse(bytes);
const hash=b=>createHash('sha256').update(b).digest('hex');
if(hash(bytes)!==matrix.bundleSha256)throw Error('STATE_RESOURCE_MISMATCH');
const dist=resolve(componentRoot,'dist');
const server=createServer(async(req,res)=>{try{
 const path=resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!path.startsWith(dist+sep))throw Error('path');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const results=[];let failure;let shotIndex=0;
try{
 browser=await chromium.launch({headless:true,...(process.env.UI_HARNESS_BROWSER?{channel:process.env.UI_HARNESS_BROWSER}:process.platform==='win32'?{channel:'chrome'}:{})});
 const page=await browser.newPage({viewport:{width:2200,height:1700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/workbench.html`);
 await page.addStyleTag({content:'.workspace{display:block!important}.left-panel,.right-panel,.canvas-toolbar,.canvas-footer,.editor-panel,.motion-system-panel,.app-header,.pipeline,.app-footer{display:none!important}.canvas-area{max-height:none!important;overflow:visible!important;padding:0!important}#canvas-host{margin:0!important}'});
 await page.waitForFunction(()=>Boolean(window.uiHarness));
 const canvas=page.locator('#canvas-host canvas');
 const at=async p=>{const r=await canvas.boundingBox();return [r.x+p[0]*r.width/bundle.document.canvas.width,r.y+p[1]*r.height/bundle.document.canvas.height];};
 const click=async p=>page.mouse.click(...await at(p));
 for(const component of matrix.components){
  await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
  for(const state of component.states){
   const get=()=>page.evaluate(id=>window.uiHarness.inspect().nodes.find(n=>n.id===id),component.componentId);
   const before=await get();if(!before?.visible)throw Error('STATE_NOT_VISIBLE');
   if(['CheckBox','Switch'].includes(component.componentType)){
    if(before.value===state.value){await click(state.point);await page.waitForFunction(({id,v})=>window.uiHarness.inspect().nodes.find(n=>n.id===id).value!==v,{id:component.componentId,v:state.value});}
    await click(state.point);
   }else if(state.action==='select'){
    const bounds=before.bounds;await click([bounds.x+bounds.width/2,bounds.y+bounds.height/2]);await click(state.point);
    // Reopen to inspect both selected field and menu raster states.
    await click([bounds.x+bounds.width/2,bounds.y+bounds.height/2]);
   }else if(state.action==='default')await page.mouse.move(1,1);
   else if(state.action==='hover')await page.mouse.move(...await at(state.point));
   else if(state.action==='pressed'){await page.mouse.move(...await at(state.point));await page.mouse.down();}
   else await click(state.point);
   if(state.value!==null)await page.waitForFunction(({id,v})=>window.uiHarness.inspect().nodes.find(n=>n.id===id).value===v,{id:component.componentId,v:state.value});
   if(!['hover','pressed'].includes(state.action))await page.mouse.move(1,1);
   const presentation=await page.evaluate(id=>window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation,component.componentId);
   const scale=['entryScale','pressScale','hoverScale','emphasisScale','dialogScale'].reduce((s,k)=>s*(presentation[k]??1),1);
   if(state.action==='pressed'&&!(scale<1))throw Error('STATE_BUTTON_PRESS_MISSING');
   const screenshotPath=`state-${String(++shotIndex).padStart(4,'0')}.png`;
   const screenshot=await canvas.screenshot({path:resolve(output,screenshotPath)});
   const checks=await page.evaluate(async({shot,parts,exclude,texts,resources,size,scale,bounds})=>{
    const decode=async data=>{const i=new Image();i.src='data:image/png;base64,'+data;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return {w:i.width,h:i.height,data:ctx.getImageData(0,0,i.width,i.height).data};};
    const actual=await decode(shot);if(actual.w!==size.width||actual.h!==size.height)throw Error('STATE_CANVAS_SCALE_MISMATCH');
    const decoded=await Promise.all(parts.map(p=>decode(resources[p.image])));
    const pixels=parts.map((p,index)=>{
     if(!p.visible)return {slot:p.slot,visible:false};
     const src=decoded[index];let seen=0,bad=0;
     for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){
      const off=(y*src.w+x)*4;if(src.data[off+3]<250)continue;
      const gx=Math.round(p.rect[0]+x),gy=Math.round(p.rect[1]+y);
      if(exclude.some(r=>gx>=r[0]&&gy>=r[1]&&gx<r[0]+r[2]&&gy<r[1]+r[3]))continue;
      // Mask pixels covered by higher state parts; do not compare hidden layers.
      if(parts.some((top,j)=>{if(j<=index||!top.visible)return false;const tx=Math.round(gx-top.rect[0]),ty=Math.round(gy-top.rect[1]);return tx>=0&&ty>=0&&tx<decoded[j].w&&ty<decoded[j].h&&decoded[j].data[(ty*decoded[j].w+tx)*4+3]>0;}))continue;
      // Sample stable opaque cores when the public runtime applies a press scale.
      if(scale!==1&&(x<3||y<3||x>=src.w-3||y>=src.h-3))continue;
      const ax=Math.round(bounds.x+bounds.width/2+(gx-bounds.x-bounds.width/2)*scale);
      const ay=Math.round(bounds.y+bounds.height/2+(gy-bounds.y-bounds.height/2)*scale);
      seen++;const pos=(ay*actual.w+ax)*4;
      if(ax<0||ay<0||ax>=actual.w||ay>=actual.h||[0,1,2].some(c=>Math.abs(actual.data[pos+c]-src.data[off+c])>12))bad++;
     }
     return {slot:p.slot,visible:true,checkedPixels:seen,badPixels:bad,pass:seen>0&&bad/seen<=.05};
    });
    for(const t of texts){
     if(!t.text.trim())continue;
     const hex=t.color.slice(1),rgb=(hex.length===3?hex.split('').map(c=>c+c).join(''):hex).match(/../g).map(c=>parseInt(c,16));
     let matched=0;for(let y=Math.ceil(t.rect[1]);y<t.rect[1]+t.rect[3];y++)for(let x=Math.ceil(t.rect[0]);x<t.rect[0]+t.rect[2];x++){
      const off=(y*actual.w+x)*4;if(rgb.every((c,i)=>Math.abs(actual.data[off+i]-c)<=12))matched++;
     }
     pixels.push({slot:'text/'+t.text,visible:true,expectedColor:t.color,matchedPixels:matched,pass:matched>=3});
    }
    return pixels;
   },{shot:screenshot.toString('base64'),parts:state.parts,exclude:state.exclude,texts:state.textRegions,resources:Object.fromEntries(bundle.resources.map(r=>[r.path,r.base64])),size:bundle.document.canvas,scale,bounds:before.bounds});
   const snapshot=await get();results.push({componentId:component.componentId,state:state.name,actualValue:snapshot.value,presentation,screenshot:screenshotPath,screenshotSha256:hash(screenshot),checks});
   await page.mouse.up();if(component.componentType==='Select')await click([before.bounds.x+before.bounds.width/2,before.bounds.y+before.bounds.height/2]);
   if(checks.some(c=>c.visible&&!c.pass))throw Error('STATE_BROWSER_PIXELS_MISMATCH');
  }
 }
 if(errors.length)throw Error('STATE_BROWSER_RUNTIME_ERROR');
}catch(e){failure=e.message;process.exitCode=2;}
finally{
 await browser?.close();await new Promise(r=>server.close(r));
 await writeFile(resolve(output,'browser.json'),JSON.stringify({kind:'ui_state_browser_v1',status:failure?'failed':'technical_passed',error:failure,results,bundleSha256:hash(bytes),matrixSha256:hash(await readFile(resolve(output,'state-matrix.json'))),human_visual_acceptance:false},null,2)+'\n');
}
