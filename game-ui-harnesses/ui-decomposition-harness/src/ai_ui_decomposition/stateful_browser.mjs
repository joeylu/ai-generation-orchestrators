// Local acceptance driver. Only the current component distribution is served.
import {prepareDialogContext,acceptDialog,isolatedModalProbe} from './stateful-dialog-browser.mjs';
import {staticChildChecks} from './stateful-static-children-browser.mjs';
import {checkListChildren} from './stateful-list-children-browser.mjs';
import {checkBoundTexts,acceptListTextProbe} from './stateful-list-text-browser.mjs';
import {verifySelectMenuHighlights} from './select-menu-highlights-browser.mjs';
import {selectLayoutChecks} from './select-layout-browser.mjs';
import {buttonLineChecks} from './button-label-lines-browser.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const [componentRoot,output]=process.argv.slice(2,4).map(p=>resolve(p));
const defaultOnly=process.argv[4]==='--default-only',prefix=defaultOnly?'preflight-':'';
const {chromium}=await import(pathToFileURL(resolve(componentRoot,'node_modules/playwright/index.mjs')));
const matrix=JSON.parse(await readFile(resolve(output,'state-matrix.json'),'utf8'));
const bytes=await readFile(resolve(output,'consumed.json'));const bundle=JSON.parse(bytes);
const hash=b=>createHash('sha256').update(b).digest('hex');
if(hash(bytes)!==matrix.bundleSha256)throw Error('STATE_RESOURCE_MISMATCH');
const linkedIds=new Set(matrix.linkedComponentIds??[]);
if(!defaultOnly&&linkedIds.size){
 const proof=JSON.parse(await readFile(resolve(output,'linkage-browser.json'),'utf8'));
 if(proof.status!=='passed'||proof.bundleSha256!==matrix.bundleSha256||proof.handoffSha256!==matrix.handoffSha256||!proof.checks?.length||proof.checks.some(c=>c.pass!==true)||JSON.stringify([...new Set(proof.coveredComponentIds)].sort())!==JSON.stringify([...linkedIds].sort()))throw Error('LINKAGE_BROWSER_RECEIPT_REQUIRED');
}
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
 await writeFile(resolve(output,prefix+'default-inspection.json'),JSON.stringify(await page.evaluate(()=>window.uiHarness.inspect()),null,2));
 const defaultBytes=await canvas.screenshot({path:resolve(output,prefix+'default.png')});
 await writeFile(resolve(output,prefix+'default-capture.json'),JSON.stringify({kind:'ui_runtime_capture_v1',bundleSha256:hash(bytes),handoffSha256:matrix.handoffSha256,screenshot:{path:prefix+'default.png',sha256:hash(defaultBytes)},inspection:{path:prefix+'default-inspection.json',sha256:hash(await readFile(resolve(output,prefix+'default-inspection.json')))},human_visual_acceptance:false},null,2));
 for(const component of defaultOnly?[]:matrix.components){
  if(linkedIds.has(component.componentId)&&component.componentType==='List')continue; // Dynamic row order/paint is checked by the bound linkage receipt; other controls retain their raster checks.
  await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
  await prepareDialogContext(page,bundle.document.root,component.componentId);
  if(component.componentType==='Dialog'){
   const saveScreenshot=async()=>{
    const path=`state-${String(++shotIndex).padStart(4,'0')}.png`;
    const bytes=await canvas.screenshot({path:resolve(output,path)});return {bytes,path,sha256:hash(bytes)};
   };
   const runModalProbe=async()=>{const {createBundle}=await import(pathToFileURL(resolve(componentRoot,'lib/bundle.js')));return isolatedModalProbe({page,component,bundle,at,createBundle,saveScreenshot,saveFixture:async fixture=>{const path=`modal-probe-${component.componentId}.ui-bundle.json`,bytes=Buffer.from(JSON.stringify(fixture));await writeFile(resolve(output,path),bytes,{flag:'wx'});return {path,sha256:hash(bytes)};}});};
   try { results.push(...await acceptDialog({page,canvas,component,bundle,at,saveScreenshot,runModalProbe})); } catch(error) { if(error.results)results.push(...error.results); throw error; }
   continue;
  }
  const selectIcons=component.componentType==='Select'&&(matrix.requireVisualLayout||component.states.some(s=>s.parts.some(p=>p.role==='option-icon')));
  const structuredScroll=component.componentType==='ScrollView'&&component.states.some(s=>s.listChildren?.length);
  const structuredList=component.componentType==='List'&&component.states.some(s=>s.listChildren?.length||s.boundTexts?.length);
  const probeText=async probe=>{
   const result=await acceptListTextProbe({page,component,probe,saveScreenshot:async phase=>{
    const path=`binding-${component.componentId}-${probe.name}-${phase}.png`,bytes=await canvas.screenshot({path:resolve(output,path)});return {path,bytes,sha256:hash(bytes)};
   }});results.push(result);if(result.checks.some(c=>!c.pass))throw Error('STATE_BOUND_TEXT_MISMATCH');
  };
  if(component.boundTextProbes)await probeText(component.boundTextProbes[0]);
  const inputs=structuredScroll?['drag','wheel','keyboard'].flatMap(inputProtocol=>component.states.filter(s=>inputProtocol!=='keyboard'||s.name!=='middle').map(s=>({...s,inputProtocol}))):structuredList?['mouse','keyboard'].flatMap(inputProtocol=>component.states.map(s=>({...s,inputProtocol}))):component.componentType==='Switch'||selectIcons?component.states.flatMap(s=>['mouse','keyboard'].map(inputProtocol=>({...s,inputProtocol}))):component.states;
  for(const state of inputs){
   if(component.componentType==='Input')await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
   const get=()=>page.evaluate(id=>window.uiHarness.inspect().nodes.find(n=>n.id===id),component.componentId);
   const before=await get();if(!before?.visible)throw Error('STATE_NOT_VISIBLE');
   let expectedSelectChanges=0;
   if(structuredScroll||component.componentType==='List')await page.evaluate(()=>document.querySelector('#events').replaceChildren());
   if(state.action==='input'){
    await page.evaluate(()=>document.querySelector('#events').replaceChildren());
    if(state.name!=='initial'){
     await click(state.point);
     if(state.name!=='disabled')await page.keyboard.press('Control+A');
     if(state.name==='empty')await page.keyboard.press('Backspace');
     else await page.keyboard.type(state.name==='limit'?state.value+'EXCESS':state.name==='edited'?state.value:'ATTEMPT');
    }
   }else if(state.action==='progress'){
    await page.evaluate(({id,value})=>window.uiHarness.setValue(id,value),{id:component.componentId,value:state.value});
   }else if(state.action==='slider'){
    const g=state.slider,ratio=(before.value-g.min)/(g.max-g.min),a=g.thumbPositions;
    const start=[before.bounds.x+a.min.x+(a.max.x-a.min.x)*ratio+g.sourceThumbCanvas.width/2,before.bounds.y+a.min.y+g.sourceThumbCanvas.height/2];
    await page.mouse.move(...await at(start));await page.mouse.down();await page.mouse.move(...await at(state.point),{steps:8});await page.mouse.up();
   }else if(structuredScroll&&state.inputProtocol==='wheel'){
    const v=state.scroll.viewport;await page.mouse.move(...await at([before.bounds.x+v.x+v.width/2,before.bounds.y+v.y+v.height/2]));
    await page.mouse.wheel(0,state.value.y-before.value.y|| (state.name==='top'?-100:100));await page.waitForTimeout(60);
   }else if(structuredScroll&&state.inputProtocol==='keyboard'){
    await canvas.focus();for(let i=0;i<200&&await canvas.getAttribute('data-focused-component')!==component.componentId;i++)await page.keyboard.press('Tab');
    if(await canvas.getAttribute('data-focused-component')!==component.componentId)throw Error('STATE_KEYBOARD_FOCUS_MISSING');
    await page.keyboard.press(state.name==='top'?'Home':'End');
   }else if(state.action==='scroll'&&state.scroll.chromeVisible!==false){
    const geometry=state.scroll,top=component.states[0].parts.find(p=>p.slot==='thumb').rect;
    const fraction=geometry.maxScrollY?before.value.y/geometry.maxScrollY:0;
    const start=[top[0]+top[2]/2,top[1]+top[3]/2+geometry.travelY*fraction];
    const target=[state.point[0],state.point[1]+(state.name==='top'?-8:state.name==='bottom'?8:0)];
    await page.mouse.move(...await at(start));await page.mouse.down();await page.mouse.move(...await at(target),{steps:8});await page.mouse.up();
   }else if(structuredList&&state.inputProtocol==='keyboard'){
    await canvas.focus();for(let i=0;i<200&&await canvas.getAttribute('data-focused-component')!==component.componentId;i++)await page.keyboard.press('Tab');
    if(await canvas.getAttribute('data-focused-component')!==component.componentId)throw Error('STATE_KEYBOARD_FOCUS_MISSING');
    const names=component.states.map(s=>s.name),from=names.indexOf(before.value),to=names.indexOf(state.name);
    for(let i=0;i<Math.abs(to-from);i++)await page.keyboard.press(to>from?'ArrowDown':'ArrowUp');
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
    await page.evaluate(()=>document.querySelector('#events').replaceChildren());
    if(state.inputProtocol==='keyboard'){
     await canvas.focus();
     for(let i=0;i<200&&await canvas.getAttribute('data-focused-component')!==component.componentId;i++)await page.keyboard.press('Tab');
     if(await canvas.getAttribute('data-focused-component')!==component.componentId)throw Error('STATE_KEYBOARD_FOCUS_MISSING');
     await page.keyboard.press('Enter');
     const names=component.states.map(s=>s.name),from=names.indexOf(before.value),to=names.indexOf(state.name);
     if(from===to&&names.length>1){
      await page.keyboard.press(to===0?'ArrowDown':'ArrowUp');await page.keyboard.press(to===0?'ArrowUp':'ArrowDown');expectedSelectChanges+=2;
     }
     for(let i=0;i<Math.abs(to-from);i++){await page.keyboard.press(to>from?'ArrowDown':'ArrowUp');expectedSelectChanges++;}
    }else{
     const bounds=before.bounds;await click([bounds.x+bounds.width/2,bounds.y+bounds.height/2]);await click(state.point);
     expectedSelectChanges=before.value===state.value?0:1;
     // Reopen to inspect both selected field and menu raster states.
     await click([bounds.x+bounds.width/2,bounds.y+bounds.height/2]);
    }
   }else if(state.action==='default'||(state.action==='scroll'&&state.scroll.chromeVisible===false))await page.mouse.move(1,1);
   else if(state.action==='hover')await page.mouse.move(...await at(state.point));
   else if(state.action==='pressed'){await page.mouse.move(...await at(state.point));await page.mouse.down();}
   else await click(state.point);
   if(state.value!==null)await page.waitForFunction(({id,v})=>{const actual=window.uiHarness.inspect().nodes.find(n=>n.id===id).value;return typeof v==='object'?Math.abs(actual.x-v.x)<.05&&Math.abs(actual.y-v.y)<.05:actual===v;},{id:component.componentId,v:state.value});
   if(structuredScroll)await page.waitForFunction(({id,y})=>{const p=window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation;return Math.abs((p.scrollY??y)-y)<.001&&Math.abs(p.scrollRecoil??0)<.001;},{id:component.componentId,y:state.value.y});
   let focusedCapture,inputEditorEvidence;
   if((structuredScroll||structuredList)&&state.inputProtocol==='keyboard'){
    const name=`focus-scroll-${shotIndex+1}.png`,bytes=await canvas.screenshot({path:resolve(output,name)});
    focusedCapture={path:name,sha256:hash(bytes),protocol:'Real keyboard boundary scroll; blur before material comparison.'};
    await canvas.evaluate(c=>c.blur());
    await page.waitForFunction(id=>Math.abs(window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation.focus??0)<.001,component.componentId);
   }
   if(component.componentType==='List')await page.waitForFunction(({id,index})=>Math.abs((window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation.listSelection??index)-index)<.001,{id:component.componentId,index:component.states.findIndex(s=>s.name===state.name)});
   if(selectIcons&&state.inputProtocol==='keyboard'){
    const name=`focus-select-${shotIndex+1}.png`,bytes=await canvas.screenshot({path:resolve(output,name)});
    focusedCapture={path:name,sha256:hash(bytes),protocol:'Real keyboard selection; focused screenshot retained before material comparison.'};
    await canvas.evaluate(c=>c.blur());
    await page.waitForFunction(()=>!document.querySelector('#canvas-host canvas').hasAttribute('data-focused-component'));
    await page.waitForFunction(id=>Math.abs(window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation.focus??0)<.001,component.componentId);
   }
   if(component.componentType==='Input'){
    inputEditorEvidence=await page.evaluate(()=>{const e=document.querySelector('#canvas-host input[aria-hidden="true"]');return e?{focused:document.activeElement===e,readOnly:e.readOnly,disabled:e.disabled}:null;});
    if(inputEditorEvidence?.focused){
     const name=`focus-${component.componentId}-${state.name}.png`,bytes=await canvas.screenshot({path:resolve(output,name)});
     focusedCapture={path:name,sha256:hash(bytes),protocol:'Real native keyboard editing; focus retained here, blur before background template comparison.'};
     await page.evaluate(()=>document.activeElement?.blur());
     await page.waitForFunction(id=>Math.abs(window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation.focus??0)<.001,component.componentId);
    }
   }
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
    const drawTexture=(ctx,i,r,slices)=>{
     if(!slices){ctx.drawImage(i,...r);return;}
     const {top,bottom}=slices,h=i.height,w=i.width,[x,y,dw,dh]=r;
     if(top)ctx.drawImage(i,0,0,w,top,x,y,dw,top);
     ctx.drawImage(i,0,top,w,h-top-bottom,x,y+top,dw,dh-top-bottom);
     if(bottom)ctx.drawImage(i,0,h-bottom,w,bottom,x,y+dh-bottom,dw,bottom);
    };
    const decode=async(data,rect,slices)=>{const i=new Image();i.src='data:image/png;base64,'+data;await i.decode();const c=document.createElement('canvas');c.width=rect?Math.ceil(rect[0]+rect[2])-Math.floor(rect[0]):i.width;c.height=rect?Math.ceil(rect[1]+rect[3])-Math.floor(rect[1]):i.height;const ctx=c.getContext('2d');drawTexture(ctx,i,[rect?rect[0]-Math.floor(rect[0]):0,rect?rect[1]-Math.floor(rect[1]):0,rect?rect[2]:i.width,rect?rect[3]:i.height],slices);return {w:c.width,h:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};};
    const actual=await decode(shot);if(actual.w!==size.width||actual.h!==size.height)throw Error('STATE_CANVAS_SCALE_MISMATCH');
    const decoded=await Promise.all(parts.map(p=>decode(resources[p.image],p.rect,p.scrollbarThumbSlices)));
    if(scale!==1){
     // Render transformed texture expectations at actual pixel centers. Nearest
     // source-pixel sampling is incorrect for textured buttons scaled by 0.97.
     const rendered=await Promise.all(parts.map(async p=>{
      const i=new Image();i.src='data:image/png;base64,'+resources[p.image];await i.decode();
      const c=document.createElement('canvas');c.width=size.width;c.height=size.height;const ctx=c.getContext('2d');
      ctx.translate(bounds.x+bounds.width/2,bounds.y+bounds.height/2);ctx.scale(scale,scale);ctx.translate(-bounds.x-bounds.width/2,-bounds.y-bounds.height/2);
      drawTexture(ctx,i,p.rect,p.scrollbarThumbSlices);return ctx.getImageData(0,0,c.width,c.height).data;
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
      const gx=Math.floor(p.rect[0])+x,gy=Math.floor(p.rect[1])+y;
      if(p.clip&&(gx<p.clip[0]||gy<p.clip[1]||gx>=p.clip[0]+p.clip[2]||gy>=p.clip[1]+p.clip[3]))continue;
      if(clip&&(gx<clip[0]||gy<clip[1]||gx>=clip[0]+clip[2]||gy>=clip[1]+clip[3]))continue;
      if(!p.staticChild&&!p.ignoreContentExclusions&&exclude.some(r=>gx>=r[0]&&gy>=r[1]&&gx<r[0]+r[2]&&gy<r[1]+r[3])){if(p.contentOcclusion)covered++;continue;}
      // Mask pixels covered by higher state parts; do not compare hidden layers.
      if(parts.some((top,j)=>{if(j<=index||!top.visible)return false;if(top.clip&&(gx<top.clip[0]||gy<top.clip[1]||gx>=top.clip[0]+top.clip[2]||gy>=top.clip[1]+top.clip[3]))return false;const tx=gx-Math.floor(top.rect[0]),ty=gy-Math.floor(top.rect[1]);return tx>=0&&ty>=0&&tx<decoded[j].w&&ty<decoded[j].h&&decoded[j].data[(ty*decoded[j].w+tx)*4+3]>0;})){covered++;continue;}
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
   checks.push(...await checkListChildren({page,children:state.listChildren,resources:Object.fromEntries(bundle.resources.map(r=>[r.path,r.base64])),saveScreenshot:async phase=>{
    const path=`list-${shotIndex}-${phase}.png`,bytes=await canvas.screenshot({path:resolve(output,path)});return {path,bytes,sha256:hash(bytes)};
   }}));
   checks.push(...await checkBoundTexts({page,entries:state.boundTexts,saveScreenshot:async phase=>{
    const path=`bound-text-${shotIndex}-${phase}.png`,bytes=await canvas.screenshot({path:resolve(output,path)});return {path,bytes,sha256:hash(bytes)};
   }}));
   if(structuredScroll||component.componentType==='List'){
    const events=(await page.locator('#events li').allTextContents()).flatMap(t=>{try{return [JSON.parse(t)];}catch{return [];}});
    const changed=structuredScroll?Math.abs(before.value.y-state.value.y)>.01:before.value!==state.value;
    const own=events.filter(e=>e.id===component.componentId&&['change','scroll'].includes(e.type));
    const validValues=structuredScroll?own.every((e,i)=>Number.isFinite(e.value?.y)&&e.value.x===0&&e.value.y>=0&&e.value.y<=state.scroll.maxScrollY&&(!i||e.value.y!==own[i-1].value.y)):own.every(e=>component.states.some(s=>s.value===e.value));
    const expectedListEvents=state.inputProtocol==='keyboard'?Math.abs(component.states.findIndex(s=>s.value===before.value)-component.states.findIndex(s=>s.value===state.value)):Number(changed);
    checks.push({slot:'list-composition/input-events',visible:true,inputProtocol:state.inputProtocol??'mouse',events,expectedChange:changed,
     pass:validValues&&(structuredScroll?(changed?own.length>0:own.length===0):own.length===expectedListEvents)&&(!structuredScroll||!events.some(e=>e.type==='change'&&e.id!==component.componentId))&&!(state.boundTexts??[]).some(t=>events.some(e=>e.id===t.nodeId&&['change','input'].includes(e.type)))});
    if(structuredScroll&&state.name!=='middle'&&state.inputProtocol!=='drag'){
     await page.evaluate(()=>document.querySelector('#events').replaceChildren());
     if(state.inputProtocol==='keyboard'){
      await canvas.focus();for(let i=0;i<200&&await canvas.getAttribute('data-focused-component')!==component.componentId;i++)await page.keyboard.press('Tab');
      await page.keyboard.press(state.name==='top'?'Home':'End');await page.keyboard.press(state.name==='top'?'ArrowUp':'ArrowDown');
     }else{const v=state.scroll.viewport;await page.mouse.move(...await at([before.bounds.x+v.x+v.width/2,before.bounds.y+v.y+v.height/2]));await page.mouse.wheel(0,state.name==='top'?-100:100);await page.mouse.wheel(0,state.name==='top'?-100:100);}
     await page.waitForTimeout(60);
     const repeated=(await page.locator('#events li').allTextContents()).flatMap(t=>{try{return [JSON.parse(t)];}catch{return [];}}),value=(await get()).value;
     checks.push({slot:'list-composition/repeated-boundary',visible:true,value,events:repeated,pass:value.x===0&&value.y===state.value.y&&!repeated.some(e=>['scroll','change'].includes(e.type))});
     if(state.inputProtocol==='keyboard')await canvas.evaluate(c=>c.blur());
     await page.waitForFunction(id=>Math.abs(window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation.scrollRecoil??0)<.001,component.componentId);
    }
   }
   if(selectIcons){
    const observed=await get();
    const events=(await page.locator('#events li').allTextContents()).flatMap(t=>{try{return [JSON.parse(t)];}catch{return [];}}).filter(e=>e.type==='change');
    checks.push({slot:'select-input-events',visible:true,events,expectedSelectChanges,pass:events.length===expectedSelectChanges&&events.every(e=>e.id===component.componentId&&e.source===state.inputProtocol)});
    for(const part of state.parts.filter(p=>p.role==='option-icon')){
     const item=observed.popupItems?.find(i=>i.optionId===part.slot.slice('option-icon/'.length)),r=item?.iconBounds;
     checks.push({slot:'select-icon-geometry/'+part.slot,visible:true,actual:r,expected:part.rect,pass:observed.popupOpen&&Boolean(r&&[r.x,r.y,r.width,r.height].every((v,i)=>Math.abs(v-part.rect[i])<.05))});
    }
    const find=n=>n.id===component.componentId?n:(n.children??[]).map(find).find(Boolean);
    for(const option of find(bundle.document.root).props.options){
     const text=observed.popupItems?.find(i=>i.optionId===option.id)?.text;
     checks.push({slot:'select-option-label/'+option.id,visible:true,actual:text,expected:option.label,pass:text===option.label||Boolean(text?.endsWith('…')&&text.length>1&&option.label.startsWith(text.slice(0,-1)))});
    }
   }
   if(component.componentType==='Input'){
    const observed=await get();const events=(await page.locator('#events li').allTextContents()).flatMap(t=>{try{return [JSON.parse(t)];}catch{return [];}});
    const blocked=['readonly','disabled'].includes(state.name);
    checks.push({slot:'input-value-events',visible:true,events,actualValue:observed.value,pass:observed.value===state.value&&(blocked?!events.some(e=>e.id===component.componentId&&['input','change'].includes(e.type)):state.name==='initial'||before.value===state.value||events.some(e=>e.id===component.componentId&&['input','change'].includes(e.type)))});
    const editor=inputEditorEvidence;
    checks.push({slot:'native-focus',visible:true,editor,pass:state.name==='initial'||Boolean(editor&&(state.name==='disabled'?!editor.focused:editor.focused))});
    const labels=observed.renderedTextBounds??[];
    const findNode=n=>n.id===component.componentId?n:(n.children??[]).map(findNode).find(Boolean);
    const props=findNode(bundle.document.root).props,expectedText=state.value||props.placeholder;
    checks.push({slot:'runtime-input-text',visible:true,labels,expectedText,pass:state.name==='limit'?labels.some(l=>l.text.startsWith('Q')):expectedText?labels.some(l=>l.text===expectedText):!labels.some(l=>l.text)});
   }
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
   if(component.selectMenuHighlights){
    const find=n=>n.id===component.componentId?n:(n.children??[]).map(find).find(Boolean);
    checks.push(...await verifySelectMenuHighlights({page,canvas,at,node:find(bundle.document.root),observed:await get(),resources:Object.fromEntries(bundle.resources.map(r=>[r.path,r.base64])),saveScreenshot:async phase=>{const path=`menu-${shotIndex}-${phase}.png`,bytes=await canvas.screenshot({path:resolve(output,path)});return {path,bytes,sha256:hash(bytes)};}}));
   }
   const snapshot=await get();
   if(component.componentType==='Button'){
    const find=n=>n.id===component.componentId?n:(n.children??[]).map(find).find(Boolean);
    checks.push(...buttonLineChecks(find(bundle.document.root),snapshot,before.bounds,scale));
   }
   if(matrix.requireVisualLayout&&component.componentType==='Select'){
    const find=n=>n.id===component.componentId?n:(n.children??[]).map(find).find(Boolean);
    checks.push(...selectLayoutChecks(find(bundle.document.root),snapshot));
   }
   results.push({componentId:component.componentId,state:state.name,inputProtocol:state.inputProtocol,focusedCapture,actualValue:snapshot.value,presentation,screenshot:screenshotPath,screenshotSha256:hash(screenshot),checks});
   await page.mouse.up();if(component.componentType==='Select'){await canvas.focus();await page.keyboard.press('Escape');}
   if(selectIcons){
    await page.waitForFunction(id=>{const n=window.uiHarness.inspect().nodes.find(n=>n.id===id);return !n.popupOpen&&!n.popupBounds&&n.popupItems.length===0;},component.componentId);
    const closed=await get(),name=`closed-${shotIndex}.png`,bytes=await canvas.screenshot({path:resolve(output,name)});
    checks.push({slot:'select-popup-destroyed',visible:true,screenshot:name,sha256:hash(bytes),pass:closed.value===state.value&&!closed.popupOpen&&closed.popupItems.length===0&&!closed.popupBounds});
   }
   if(checks.some(c=>c.visible&&!c.occluded&&!c.pass))throw Error('STATE_BROWSER_PIXELS_MISMATCH');
  }
  if(component.componentType==='Button'){
   const find=n=>n.id===component.componentId?n:(n.children??[]).map(find).find(Boolean),node=find(bundle.document.root);
   if(node.props.appearance?.labelLines){
    await page.mouse.move(1,1);await canvas.evaluate(c=>c.blur());await page.waitForTimeout(160);
    const before=await page.evaluate(id=>window.uiHarness.inspect().nodes.find(n=>n.id===id),component.componentId);
    for(const inputProtocol of ['mouse','keyboard']){
     await page.evaluate(()=>document.querySelector('#events').replaceChildren());
     if(inputProtocol==='mouse')await click([before.bounds.x+before.bounds.width/2,before.bounds.y+before.bounds.height/2]);
     else{await canvas.focus();for(let i=0;i<200&&await canvas.getAttribute('data-focused-component')!==component.componentId;i++)await page.keyboard.press('Tab');if(await canvas.getAttribute('data-focused-component')!==component.componentId)throw Error('BUTTON_FOCUS_UNREACHABLE');await page.keyboard.press('Space');}
     await page.mouse.move(1,1);await canvas.evaluate(c=>c.blur());await page.waitForTimeout(160);
     const observed=await page.evaluate(id=>window.uiHarness.inspect().nodes.find(n=>n.id===id),component.componentId);
     const events=(await page.locator('#events li').allTextContents()).map(t=>JSON.parse(t)).filter(e=>e.id===component.componentId&&e.type==='activate');
     const checks=buttonLineChecks(node,observed,before.bounds);checks.push({slot:'button-real-activation',visible:true,events,pass:events.length===1&&events[0].source===inputProtocol});
     const path=`button-${component.componentId}-${inputProtocol}.png`,shot=await canvas.screenshot({path:resolve(output,path)});
     results.push({componentId:component.componentId,state:'activation',inputProtocol,screenshot:path,screenshotSha256:hash(shot),checks});
     if(checks.some(c=>!c.pass))throw Error('BUTTON_ACTIVATION_OR_LABEL_FAILED');
    }
   }
  }
  if(component.boundTextProbes)for(const probe of component.boundTextProbes.slice(1))await probeText(probe);
 }
 if(errors.length)throw Error('STATE_BROWSER_RUNTIME_ERROR');
}catch(e){failure=e.message;process.exitCode=2;}
finally{
 await browser?.close();await new Promise(r=>server.close(r));
 await writeFile(resolve(output,prefix+'browser.json'),JSON.stringify({kind:defaultOnly?'ui_default_preview_v1':'ui_state_browser_v1',status:failure?'failed':defaultOnly?'captured':matrix.acceptanceScope?.mode==='targeted'?'targeted_passed':'technical_passed',acceptanceScope:matrix.acceptanceScope,error:failure,results,bundleSha256:hash(bytes),matrixSha256:hash(await readFile(resolve(output,'state-matrix.json'))),human_visual_acceptance:false},null,2)+'\n');
}
