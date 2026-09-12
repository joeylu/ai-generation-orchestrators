// Local acceptance driver. Only the current component distribution is served.
import {prepareDialogContext,acceptDialog} from './stateful-dialog-browser.mjs';
import {staticChildChecks} from './stateful-static-children-browser.mjs';
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
 await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
 await writeFile(resolve(output,'default-inspection.json'),JSON.stringify(await page.evaluate(()=>window.uiHarness.inspect()),null,2));
 for(const component of matrix.components){
  await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
  await prepareDialogContext(page,bundle.document.root,component.componentId);
  if(component.componentType==='Dialog'){
   try { results.push(...await acceptDialog({page,canvas,component,bundle,at,saveScreenshot:async()=>{
    const path=`state-${String(++shotIndex).padStart(4,'0')}.png`;
    const bytes=await canvas.screenshot({path:resolve(output,path)});return {bytes,path,sha256:hash(bytes)};
   }})); } catch(error) { if(error.results)results.push(...error.results); throw error; }
   continue;
  }
  const inputs=component.componentType==='Switch'?component.states.flatMap(s=>['mouse','keyboard'].map(inputProtocol=>({...s,inputProtocol}))):component.states;
  for(const state of inputs){
   const get=()=>page.evaluate(id=>window.uiHarness.inspect().nodes.find(n=>n.id===id),component.componentId);
   const before=await get();if(!before?.visible)throw Error('STATE_NOT_VISIBLE');
   if(state.action==='progress'){
    await page.evaluate(({id,value})=>window.uiHarness.setValue(id,value),{id:component.componentId,value:state.value});
   }else if(state.action==='slider'){
    const g=state.slider,ratio=(before.value-g.min)/(g.max-g.min),a=g.thumbPositions;
    const start=[before.bounds.x+a.min.x+(a.max.x-a.min.x)*ratio+g.sourceThumbCanvas.width/2,before.bounds.y+a.min.y+g.sourceThumbCanvas.height/2];
    await page.mouse.move(...await at(start));await page.mouse.down();await page.mouse.move(...await at(state.point),{steps:8});await page.mouse.up();
   }else if(state.action==='scroll'&&state.scroll.chromeVisible!==false){
    const geometry=state.scroll,top=component.states[0].parts.find(p=>p.slot==='thumb').rect;
    const fraction=geometry.maxScrollY?before.value.y/geometry.maxScrollY:0;
    const start=[top[0]+top[2]/2,top[1]+top[3]/2+geometry.travelY*fraction];
    const target=[state.point[0],state.point[1]+(state.name==='top'?-8:state.name==='bottom'?8:0)];
    await page.mouse.move(...await at(start));await page.mouse.down();await page.mouse.move(...await at(target),{steps:8});await page.mouse.up();
   }else if(component.componentType==='Switch'){
    const toggle=async()=>{
     if(state.inputProtocol==='mouse')await click(state.point);
     else {
      await canvas.focus();
      for(let i=0;i<200&&await canvas.getAttribute('data-focused-component')!==component.componentId;i++)await page.keyboard.press('Tab');
      if(await canvas.getAttribute('data-focused-component')!==component.componentId)throw Error('STATE_KEYBOARD_FOCUS_MISSING');
      await page.keyboard.press('Space');
     }
    };
    if(before.value===state.value){await toggle();await page.waitForFunction(({id,v})=>window.uiHarness.inspect().nodes.find(n=>n.id===id).value!==v,{id:component.componentId,v:state.value});}
    await page.evaluate(()=>document.querySelector('#events').replaceChildren());
    await toggle();
   }else if(component.componentType==='CheckBox'){
    if(before.value===state.value){await click(state.point);await page.waitForFunction(({id,v})=>window.uiHarness.inspect().nodes.find(n=>n.id===id).value!==v,{id:component.componentId,v:state.value});}
    await click(state.point);
   }else if(state.action==='select'){
    const bounds=before.bounds;await click([bounds.x+bounds.width/2,bounds.y+bounds.height/2]);await click(state.point);
    // Reopen to inspect both selected field and menu raster states.
    await click([bounds.x+bounds.width/2,bounds.y+bounds.height/2]);
   }else if(state.action==='default'||(state.action==='scroll'&&state.scroll.chromeVisible===false))await page.mouse.move(1,1);
   else if(state.action==='hover')await page.mouse.move(...await at(state.point));
   else if(state.action==='pressed'){await page.mouse.move(...await at(state.point));await page.mouse.down();}
   else await click(state.point);
   if(state.value!==null)await page.waitForFunction(({id,v})=>{const actual=window.uiHarness.inspect().nodes.find(n=>n.id===id).value;return typeof v==='object'?Math.abs(actual.x-v.x)<.05&&Math.abs(actual.y-v.y)<.05:actual===v;},{id:component.componentId,v:state.value});
   let focusedCapture;
   if(component.componentType==='Switch'){
    await page.waitForFunction(({id,value})=>Math.abs((window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation.checked??Number(value))-Number(value))<.001,{id:component.componentId,value:state.value});
    if(state.inputProtocol==='keyboard'){
     if(await canvas.getAttribute('data-focused-component')!==component.componentId)throw Error('STATE_KEYBOARD_FOCUS_MISSING');
     const name=`focus-${component.componentId}-${state.name}.png`,bytes=await canvas.screenshot({path:resolve(output,name)});
     focusedCapture={path:name,sha256:hash(bytes),componentId:component.componentId,protocol:'Real keyboard input; focused screenshot retained; canvas blur before unoccluded material comparison.'};
     await canvas.evaluate(c=>c.blur());
     await page.waitForFunction(()=>!document.querySelector('#canvas-host canvas').hasAttribute('data-focused-component'));
    }
   }
   if(!['hover','pressed'].includes(state.action))await page.mouse.move(1,1);
   const presentation=await page.evaluate(id=>window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation,component.componentId);
   const scale=['entryScale','pressScale','hoverScale','emphasisScale','dialogScale'].reduce((s,k)=>s*(presentation[k]??1),1);
   if(state.action==='pressed'&&!(scale<1))throw Error('STATE_BUTTON_PRESS_MISSING');
   const screenshotPath=`state-${String(++shotIndex).padStart(4,'0')}.png`;
   const screenshot=await canvas.screenshot({path:resolve(output,screenshotPath)});
   const checks=await page.evaluate(async({shot,parts,exclude,texts,resources,size,scale,bounds,clip})=>{
    const decode=async(data,rect)=>{const i=new Image();i.src='data:image/png;base64,'+data;await i.decode();const c=document.createElement('canvas');c.width=rect?Math.ceil(rect[2]):i.width;c.height=rect?Math.ceil(rect[3]):i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0,rect?rect[2]:i.width,rect?rect[3]:i.height);return {w:c.width,h:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};};
    const actual=await decode(shot);if(actual.w!==size.width||actual.h!==size.height)throw Error('STATE_CANVAS_SCALE_MISMATCH');
    const decoded=await Promise.all(parts.map(p=>decode(resources[p.image],p.rect)));
    if(scale!==1){
     // Render transformed texture expectations at actual pixel centers. Nearest
     // source-pixel sampling is incorrect for textured buttons scaled by 0.97.
     const rendered=await Promise.all(parts.map(async p=>{
      const i=new Image();i.src='data:image/png;base64,'+resources[p.image];await i.decode();
      const c=document.createElement('canvas');c.width=size.width;c.height=size.height;const ctx=c.getContext('2d');
      ctx.translate(bounds.x+bounds.width/2,bounds.y+bounds.height/2);ctx.scale(scale,scale);ctx.translate(-bounds.x-bounds.width/2,-bounds.y-bounds.height/2);
      ctx.drawImage(i,...p.rect);return ctx.getImageData(0,0,c.width,c.height).data;
     }));
     return parts.map((p,index)=>{
      if(!p.visible)return {slot:p.slot,visible:false};let seen=0,bad=0;
      const expected=rendered[index];
      for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
       const off=(y*size.width+x)*4;if(expected[off+3]<250)continue;
       const ox=bounds.x+bounds.width/2+(x-bounds.x-bounds.width/2)/scale,oy=bounds.y+bounds.height/2+(y-bounds.y-bounds.height/2)/scale;
       if(clip&&(x<clip[0]||y<clip[1]||x>=clip[0]+clip[2]||y>=clip[1]+clip[3]))continue;
       if(!p.staticChild&&exclude.some(r=>ox>=r[0]&&oy>=r[1]&&ox<r[0]+r[2]&&oy<r[1]+r[3]))continue;
       if(parts.some((top,j)=>j>index&&top.visible&&rendered[j][off+3]>0))continue;
       seen++;if([0,1,2].some(k=>Math.abs(expected[off+k]-actual.data[off+k])>12))bad++;
      }
      return {slot:p.slot,visible:true,checkedPixels:seen,badPixels:bad,pass:seen>0&&bad/seen<=.05};
     });
    }
    const pixels=parts.map((p,index)=>{
     if(!p.visible)return {slot:p.slot,visible:false};
     const src=decoded[index];let seen=0,bad=0,covered=0;
     for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){
      const off=(y*src.w+x)*4;if(src.data[off+3]<250)continue;
      const gx=Math.round(p.rect[0]+x),gy=Math.round(p.rect[1]+y);
      if(p.clip&&(gx<p.clip[0]||gy<p.clip[1]||gx>=p.clip[0]+p.clip[2]||gy>=p.clip[1]+p.clip[3]))continue;
      if(clip&&(gx<clip[0]||gy<clip[1]||gx>=clip[0]+clip[2]||gy>=clip[1]+clip[3]))continue;
      if(!p.staticChild&&!p.ignoreContentExclusions&&exclude.some(r=>gx>=r[0]&&gy>=r[1]&&gx<r[0]+r[2]&&gy<r[1]+r[3])){if(p.contentOcclusion)covered++;continue;}
      // Mask pixels covered by higher state parts; do not compare hidden layers.
      if(parts.some((top,j)=>{if(j<=index||!top.visible)return false;if(top.clip&&(gx<top.clip[0]||gy<top.clip[1]||gx>=top.clip[0]+top.clip[2]||gy>=top.clip[1]+top.clip[3]))return false;const tx=Math.round(gx-top.rect[0]),ty=Math.round(gy-top.rect[1]);return tx>=0&&ty>=0&&tx<decoded[j].w&&ty<decoded[j].h&&decoded[j].data[(ty*decoded[j].w+tx)*4+3]>0;})){covered++;continue;}
      // Sample stable opaque cores when the public runtime applies a press scale.
      if(scale!==1&&(x<3||y<3||x>=src.w-3||y>=src.h-3))continue;
      const ax=Math.round(bounds.x+bounds.width/2+(gx-bounds.x-bounds.width/2)*scale);
      const ay=Math.round(bounds.y+bounds.height/2+(gy-bounds.y-bounds.height/2)*scale);
      seen++;const pos=(ay*actual.w+ax)*4;
      if(ax<0||ay<0||ax>=actual.w||ay>=actual.h||[0,1,2].some(c=>Math.abs(actual.data[pos+c]-src.data[off+c])>12))bad++;
     }
     return {slot:p.slot,visible:true,checkedPixels:seen,badPixels:bad,coveredPixels:covered,
      occluded:seen===0&&covered>0,pass:seen===0&&covered>0?null:seen>0&&bad/seen<=.05};
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
   },{shot:screenshot.toString('base64'),parts:[...state.parts,...(state.staticChildren??[])],exclude:state.exclude,texts:state.textRegions,resources:Object.fromEntries(bundle.resources.map(r=>[r.path,r.base64])),size:bundle.document.canvas,scale,bounds:before.bounds,clip:state.clip});
   if(component.componentType==='Switch' && state.textRegions.length){
    const observed=(await get()).renderedLabels??[];
    for(const expected of state.textRegions){const r=expected.rect,label=observed.find(t=>t.text===expected.text);
     checks.push({slot:'runtime-text/'+expected.text,visible:true,expectedText:expected.text,actualLabels:observed,pass:Boolean(label&&Math.abs(label.x-(r[0]-before.bounds.x))<.1&&label.y>=r[1]-before.bounds.y-.1&&label.y+label.height<=r[1]-before.bounds.y+r[3]+.1)});
    }
   }
   checks.push(...await staticChildChecks(page,state.staticChildren,scale,before.bounds));
   if(state.scroll){
    const children=await page.evaluate(()=>window.uiHarness.inspect().nodes);
    for(const expected of state.scroll.children){const actual=children.find(n=>n.id===expected.id)?.bounds;
     checks.push({slot:'content/'+expected.id,visible:true,expected,actual,pass:Boolean(actual&&Math.abs(actual.x-expected.x)<.05&&Math.abs(actual.y-expected.y)<.05)});
    }
   }
   if(component.componentType==='Switch'){
    const events=await page.locator('#events li').allTextContents();
    const parsed=events.flatMap(t=>{try{return [JSON.parse(t)];}catch{return [];}});
    checks.push({slot:'input-event',visible:true,inputProtocol:state.inputProtocol,events:parsed,pass:parsed.some(e=>e.id===component.componentId&&e.type==='change'&&e.source===state.inputProtocol&&e.value===state.value)});
   }
   const snapshot=await get();results.push({componentId:component.componentId,state:state.name,inputProtocol:state.inputProtocol,focusedCapture,actualValue:snapshot.value,presentation,screenshot:screenshotPath,screenshotSha256:hash(screenshot),checks});
   await page.mouse.up();if(component.componentType==='Select')await click([before.bounds.x+before.bounds.width/2,before.bounds.y+before.bounds.height/2]);
   if(checks.some(c=>c.visible&&!c.occluded&&!c.pass))throw Error('STATE_BROWSER_PIXELS_MISMATCH');
  }
 }
 if(errors.length)throw Error('STATE_BROWSER_RUNTIME_ERROR');
}catch(e){failure=e.message;process.exitCode=2;}
finally{
 await browser?.close();await new Promise(r=>server.close(r));
 await writeFile(resolve(output,'browser.json'),JSON.stringify({kind:'ui_state_browser_v1',status:failure?'failed':'technical_passed',error:failure,results,bundleSha256:hash(bytes),matrixSha256:hash(await readFile(resolve(output,'state-matrix.json'))),human_visual_acceptance:false},null,2)+'\n');
}
