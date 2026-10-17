// Offline acceptance of verified action previews. No Studio mutation or model adapter.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {readSafe,hash,json} from '../src/skins/package.mjs';
import {initialFieldState} from '../src/panel/action-behavior.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const {values,positionals}=parseArgs({allowPositionals:true,options:{screenshots:{type:'string'},orientation:{type:'string'},require:{type:'string'}}});
if(positionals.length!==1||!values.screenshots)throw Error('Use studio-layout-check.mjs <preview-directory> --screenshots <outside-repository-directory> [--orientation landscape|portrait] [--require row,column,nested,fill,content,grid]');
const input=resolve(positionals[0]),screenshots=resolve(values.screenshots);
const repo=resolve(root,'../..'),screenshotRelative=relative(repo,screenshots);
if(!isAbsolute(screenshotRelative)&&screenshotRelative!=='..'&&!screenshotRelative.startsWith('..'+sep))throw Error('Screenshots must be outside the repository');
if(values.orientation&&!['landscape','portrait'].includes(values.orientation))throw Error('Invalid orientation');
const required=(values.require??'').split(',').filter(Boolean);
if(required.some(key=>!['row','column','grid','nested','fill','content'].includes(key)))throw Error('Unknown required layout feature');
const reportBytes=await readSafe(input,'report.json'),report=JSON.parse(reportBytes);
assert.equal(report.kind,'action-panel-preview');assert.equal(report.source,'offline-fixtures');
for(const file of report.files)assert.equal(hash(await readSafe(input,file.file)),file.sha256,'Verified preview: '+file.file);
const html=await readSafe(input,'preview.html'),presets=JSON.parse(await readSafe(input,'presets.json'));
assert.ok(presets.length,'At least one compiled preset');
if(values.orientation)for(const preset of presets)assert.deepEqual(Object.keys(preset.documents),[values.orientation],'Only the preselected orientation is delivered');
const output=join(root,'work/panels/studio-layout-checks',randomUUID());
await mkdir(output,{recursive:true});await mkdir(screenshots,{recursive:true});
const checks=[],samples=[],errors=[],features=new Set();
const check=(name,value=true)=>{assert.ok(value,name);checks.push(name);};
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:'block'});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push('console '+message.type()+': '+message.text());});
 const url='http://127.0.0.1/studio-layout-check';
 await page.route('**/*',route=>route.request().url()===url?route.fulfill({body:html,contentType:'text/html'}):route.abort());
 await page.goto(url);await page.waitForFunction(()=>window.actionPreview);
 check('page identity',await page.title()==='面板预览');check('meaningful preview content',await page.locator('#stage canvas').count()===1);
 for(const [index,preset] of presets.entries())for(const orientation of Object.keys(preset.documents)){
  const label=preset.content.id+' / '+orientation;
  await page.evaluate(({index,orientation})=>actionPreview.render(index,orientation),{index,orientation});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  check(label+': exported authored document',JSON.stringify(await page.evaluate(()=>actionPreview.exportValue().document))===JSON.stringify(preset.documents[orientation]));
  const before=await page.evaluate(()=>actionPreview.exportValue());
  const sample=await page.evaluate(()=>{
   const p=actionPreview,r=p.scene.runtime,doc=p.scene.document,tolerance=.6;
   const inside=(b,c)=>b.x>=c.x-tolerance&&b.y>=c.y-tolerance&&b.x+b.width<=c.x+c.width+tolerance&&b.y+b.height<=c.y+c.height+tolerance;
   const localBounds=(h,parent)=>{const origin=parent.root.toLocal(h.root.toGlobal({x:0,y:0}));return {x:origin.x,y:origin.y,...h.size};};
   const visible=h=>{for(let view=h.root;view;view=view.parent)if(!view.visible||!view.renderable||view.alpha<=0)return false;return true;};
   const problems=[],nodes=[],layoutFeatures=new Set();
   for(const node of doc.nodes){
    const h=r.handles.get(node.id),parent=h.parent;
    try{h.preflight(h.size.width,h.size.height);}catch(error){problems.push({id:h.id,check:'component-skin-text-size',code:error.code??error.message});}
    const literal=value=>String(value).replace(/\s+/g,' '),expectLabel=(actual,expected,part)=>{if(actual!==literal(expected))problems.push({id:h.id,check:'complete-control-label',part,expected:literal(expected),actual});};
    if(h.recipe.type==='Button')expectLabel(h.adapter.view.labelView.text,h.props.label,'button');
    if(h.recipe.type==='Select'){
     const v=h.adapter.view,selected=h.props.options.find(option=>option.id===h.readState().selectedId)?.label??h.props.placeholder;
     for(const [index,row] of v.rows.entries())expectLabel(row.labelView.text,h.props.options[index].label,'option '+index);
     for(const [index,button] of [v.openButton,v.closeButton].entries())expectLabel(button.labelView?.text??button._views.textView?.text,selected,'selected '+index);
    }
    const active=visible(h),origin=h.root.toGlobal({x:0,y:0}),frame={x:origin.x,y:origin.y,...h.size};
    let scrolled=false;for(let ancestor=parent;ancestor;ancestor=ancestor.parent)if(ancestor.recipe.type==='ScrollView'||ancestor.recipe.type==='List')scrolled=true;
    if(active&&!scrolled&&!inside(frame,{x:0,y:0,width:p.app.screen.width,height:p.app.screen.height}))problems.push({id:h.id,check:'canvas-boundary',frame});
    if(active&&parent&&!['ScrollView','List'].includes(parent.recipe.type)){
     const local=localBounds(h,parent),safe=parent.recipe.type==='Panel'?parent.props.contentPadding??r.skin.insets('skin.surface.panel'):{left:0,right:0,top:0,bottom:0};
     const parentFrame={x:safe.left,y:safe.top,width:parent.size.width-safe.left-safe.right,height:parent.size.height-safe.top-safe.bottom};
     if(!inside(local,parentFrame))problems.push({id:h.id,check:'parent-content-boundary',parent:parent.id,frame:local,safe:parentFrame});
    }
    if(h.sizing.widthMode==='fill')layoutFeatures.add('fill');
    if(h.sizing.heightMode==='content')layoutFeatures.add('content');
    const childIds=Object.values(node.slots).flat(),children=childIds.map(id=>r.handles.get(id)).filter(visible);
    if(h.recipe.type==='Container'&&h.layout.childrenMode==='flow'&&children.length){
     layoutFeatures.add(h.layout.direction??'column');
     if(children.some(child=>child.recipe.type==='Container'))layoutFeatures.add('nested');
     const boxes=children.map(child=>({id:child.id,...localBounds(child,h)})),gap=h.layout.gap??8,pad=h.layout.padding??0;
     if(['row','column'].includes(h.layout.direction)){
      const axis=h.layout.direction==='row'?'x':'y',length=axis==='x'?'width':'height';
      for(let i=1;i<boxes.length;i++)if(boxes[i][axis]<boxes[i-1][axis]+boxes[i-1][length]+gap-tolerance)problems.push({id:h.id,check:'flow-order-overlap',children:[boxes[i-1],boxes[i]]});
      if(h.layout.direction==='row'&&children.length>1&&children.every(child=>child.sizing.widthMode==='fill'&&!child.sizing.grow)){
       if(Math.max(...boxes.map(box=>box.width))-Math.min(...boxes.map(box=>box.width))>tolerance)problems.push({id:h.id,check:'equal-row-fill',children:boxes});
      }
      if(h.sizing.heightMode==='content'){
       const natural=(h.layout.direction==='column'?boxes.reduce((sum,box)=>sum+box.height,0)+gap*(boxes.length-1):Math.max(...boxes.map(box=>box.height)))+pad*2;
       if(Math.abs(h.size.height-Math.max(24,natural))>tolerance)problems.push({id:h.id,check:'content-height',actual:h.size.height,natural});
      }
     }
    }
    nodes.push({id:h.id,type:h.recipe.type,parent:parent?.id??null,size:{...h.size},position:{x:origin.x,y:origin.y},visible:active,scrolled,sizing:h.sizing,layout:h.layout});
   }
   return {canvas:{width:p.app.screen.width,height:p.app.screen.height},nodes,problems,features:[...layoutFeatures]};
  });
  const observed={presetId:preset.content.presetId,id:preset.content.id,orientation,...sample};samples.push(observed);
  for(const feature of sample.features)features.add(feature);
  check(label+': actual node minima, skin slices, readable text and boundaries',sample.problems.length===0);
  check(label+': selected canvas ratio',orientation==='landscape'?sample.canvas.width*9===sample.canvas.height*16:sample.canvas.width*16===sample.canvas.height*9);
  const reveal=async id=>page.evaluate(id=>{
   const r=actionPreview.scene.runtime,h=r.handles.get(id);let owner=h.parent;
   while(owner&&owner.recipe.type!=='ScrollView')owner=owner.parent;
   if(!owner)return;
   const target=h.root.getBounds(),viewport=owner.adapter.box.getBounds(),offset=owner.readState().initialOffsetY??0;
   const max=Math.max(0,owner.adapter.box.contentHeight-owner.adapter.box.height);
   owner.setState({initialOffsetY:Math.min(max,Math.max(0,offset+target.y-viewport.y-12))});r.flush();
  },id);
  const click=async id=>{
   await reveal(id);
   const point=await page.evaluate(id=>{const p=actionPreview,h=p.scene.runtime.handles.get(id),bounds=h.adapter.view.getBounds(),canvas=p.app.canvas.getBoundingClientRect();return {x:canvas.left+(bounds.x+bounds.width/2)*canvas.width/p.app.screen.width,y:canvas.top+(bounds.y+bounds.height/2)*canvas.height/p.app.screen.height};},id);
   await page.mouse.click(point.x,point.y);
  };
  const inputField=preset.behavior.fields.find(field=>field.type==='input'&&field.enabled&&!field.readOnly);
  if(inputField){
   const value='测'.repeat(Math.max(inputField.minLength??0,Math.min(inputField.maxLength??8,4)));
   await click(inputField.id);await page.locator('input:visible').fill(value);await page.locator('input:visible').press('Enter');
   check(label+': native text entry retained',(await page.evaluate(()=>actionPreview.state))[inputField.id].value===value);
  }
  const toggle=preset.behavior.fields.find(field=>['switch','check-box'].includes(field.type)&&field.enabled);
  if(toggle){
   const old=(await page.evaluate(()=>actionPreview.state))[toggle.id].checked;
   await click(toggle.id);check(label+': pointer toggle retained',(await page.evaluate(()=>actionPreview.state))[toggle.id].checked===!old);
  }
  const submit=preset.behavior.actions.find(action=>action.action==='submit'&&action.enabled);
  if(submit){
   await click(submit.id);const result=await page.evaluate(()=>actionPreview.lastResult);
   check(label+': local submit retained',result?.event?.action==='submit'&&result.errors.length===0&&JSON.stringify(result.event.values)===JSON.stringify(Object.fromEntries(submit.targets.map(id=>[id,result.state[id]]))));
  }
  const reset=preset.behavior.actions.find(action=>action.action==='reset-initial'&&action.enabled);
  if(reset){
   await click(reset.id);const state=await page.evaluate(()=>actionPreview.state);
   for(const id of reset.targets)assert.deepEqual(state[id],initialFieldState(preset.behavior.fields.find(field=>field.id===id)),label+': reset '+id);
   check(label+': exact local reset retained');
  }
  check(label+': play state does not alter authored export',JSON.stringify(await page.evaluate(()=>actionPreview.exportValue()))===JSON.stringify(before));
  await page.evaluate(({index,orientation})=>actionPreview.render(index,orientation),{index,orientation});
  const screenshot=preset.content.id+'-'+orientation+'.png';await page.locator('canvas').screenshot({path:join(screenshots,screenshot)});
  observed.screenshot=join(screenshots,screenshot);
 }
 for(const feature of required)check('required layout feature: '+feature,features.has(feature));
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(requestAnimationFrame));
 check('mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:join(screenshots,'mobile.png'),fullPage:true});
 check('no browser runtime errors',errors.length===0);
 await writeFile(join(output,'report.json'),json({kind:'ui_studio_layout_check',status:'passed',input:relative(root,input).replaceAll('\\','/'),inputReportSha256:hash(reportBytes),browser:'Edge / Playwright; Browser plugin not available',modelCalls:0,source:'offline-fixtures',checks,features:[...features],errors,samples}),{flag:'wx'});
 console.log(json({status:'passed',checks:checks.length,samples:samples.length,directory:relative(root,output).replaceAll('\\','/')}));
}catch(error){
 await writeFile(join(output,'report.json'),json({kind:'ui_studio_layout_check',status:'failed',modelCalls:0,source:'offline-fixtures',checks,errors,samples,error:error.message}),{flag:'wx'});throw error;
}finally{await browser.close();}
