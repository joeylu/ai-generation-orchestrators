import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {startHarness} from './harness.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('three styles: all 16 controls, internal transitions, interrupted overlays, direct manipulation and teardown',async()=>{
 const env=await startHarness({width:1440,height:1120});const {page}=env;
 try{
  const bundle=await build({stdin:{contents:"import {attachComponentMotion} from './src/panel/motion-runtime.mjs';import {motionSelection} from './src/panel/motion-profile.mjs';import {upgradeInventoryRegistry} from './src/runtime/inventory-policy.mjs';window.motionAPI={attachComponentMotion,motionSelection,upgradeInventoryRegistry};",resolveDir:root},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
  await page.addScriptTag({type:'module',content:bundle.outputFiles[0].text});await page.waitForFunction(()=>window.motionAPI);
  await page.evaluate(()=>{
   harness.clear();harness.app.ticker.stop();let now=0,sequence=0;const frames=new Map();
   window.motionMedia={matches:false,addEventListener(){},removeEventListener(){}};
   const items=harness.cases.map((c,i)=>{const n=harness.make(c.type,{props:c.type==='Dialog'?{modal:false}:{}},false);n.root.position.set(25+i%4*350,20+Math.floor(i/4)*270);harness.runtime.mount(n);return{n};});
   window.motionNodes=Object.fromEntries(items.map(({n})=>[n.recipe.type,n]));
   window.motionWin={studioCanvas:{items,h:{app:harness.app,runtime:harness.runtime}},performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>motionMedia,document};
   window.motionStep=(ms=16)=>{harness.app.ticker.update(harness.app.ticker.lastTime+16);now+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now));};
   window.motionFlush=()=>{for(let i=0;i<4;i++)motionStep(400);};
   window.motionController=motionAPI.attachComponentMotion(motionWin,motionAPI.motionSelection('original','components'));
  });
  const before=await page.evaluate(()=>Object.values(motionNodes).map(h=>h.snapshot()));
  for(const style of ['playful','premium','corporate']){
   const result=await page.evaluate(style=>{
    motionController.set(motionAPI.motionSelection(style,'components'));motionFlush();harness.events.length=0;
    const select=motionNodes.Select.adapter.view;select.open();motionStep(50);
    const selectMid={logical:select.expanded,progress:select.motionProgress,visible:select.view.visible,textScale:select.rows[0].scale.y,aboveBackground:select.view.getChildIndex(select.scrollBox)>select.view.getChildIndex(select.openView)};
    select.close();const selectClose={logical:select.expanded,visible:select.view.visible,mode:select.view.eventMode};motionStep(40);const closing=select.motionProgress;select.open();motionFlush();const reopened=select.expanded&&select.motionProgress===1;select.close();motionFlush();
    const dialog=motionNodes.Dialog;dialog.setState({open:false});const closingDialog={logical:dialog.readState().open,visible:dialog.adapter.view.visible};motionStep(50);const dialogMid=dialog.adapter.view.motionProgress;dialog.setState({open:true});motionFlush();const dialogReopen=dialog.adapter.view.isOpen&&dialog.adapter.view.innerView.alpha===1;
    dialog.adapter.buttons[0].onPress.emit();motionStep(50);const closeEvents=harness.events.filter(e=>e.nodeId===dialog.id).map(e=>e.event);dialog.adapter.buttons[0].onPress.emit();motionFlush();const closeEnd={visible:dialog.adapter.view.visible,events:harness.events.filter(e=>e.nodeId===dialog.id).map(e=>e.event)};dialog.setState({open:true});motionFlush();
    const sw=motionNodes.Switch,was=sw.readState().checked;sw.setState({checked:!was});motionStep(50);const thumb=sw.adapter.view.views[sw.readState().checked?1:0].children[1].x;motionFlush();
    const ck=motionNodes.CheckBox;ck.setState({checked:!ck.readState().checked});motionStep(15);const checkAlpha=ck.adapter.view.views[1].children[1].alpha;motionFlush();
    const radio=motionNodes.RadioGroup;radio.setState({selectedId:radio.props.options.find(o=>o.id!==radio.readState().selectedId).id});motionStep(15);const radioMid=radio.adapter.items.some(b=>b.views[1].children[1].alpha>0&&b.views[1].children[1].alpha<1);motionFlush();
    const bar=motionNodes.ProgressBar;bar.setState({value:0});motionFlush();bar.setState({value:100});motionStep(50);const progress={logical:bar.readState().value,visual:bar.adapter.bar.progress};motionFlush();
    const slider=motionNodes.Slider;slider.setState({value:0});motionFlush();slider.setState({value:100});motionStep(50);const slide={logical:slider.readState().value,visual:slider.adapter.view.progress};motionFlush();
    slider.adapter.view.dragging=1;slider.setState({value:20});motionStep(16);const direct=slider.adapter.view.progress;slider.adapter.view.dragging=0;
    const tabs=motionNodes.Tabs;tabs.setState({activeId:tabs.readState().activeId==='a'?'b':'a'});motionStep(50);const pageAlpha=tabs.adapter.switcher.alpha*tabs.adapter.switcher.activeView.alpha;motionFlush();
    const list=motionNodes.List;list.setState({selectedId:list.props.items[0].id});motionStep(20);list.setState({selectedId:list.props.items[1].id});motionStep(20);list.setState({selectedId:list.props.items[0].id});motionFlush();const rowAlphas=list.adapter.rows.map(b=>(b.view??b).alpha);
    const scroll=motionNodes.ScrollView;scroll.setState({initialOffsetY:0});motionFlush();scroll.setState({initialOffsetY:100});motionStep(50);const scrollMid={logical:scroll.readState().initialOffsetY,pivot:scroll.adapter.box.list.pivot.y};motionFlush();
    return {selectMid,selectClose,closing,reopened,selectEnd:!select.expanded&&!select.view.visible,closingDialog,dialogMid,dialogReopen,closeEvents,closeEnd,thumb,checkAlpha,radioMid,progress,slide,direct,pageAlpha,rowAlphas,scrollMid,error:motionController.inspect().error,targets:motionController.inspect().targets.length};
   },style);
   assert.ok(result.targets>=16);assert.equal(result.error,null,style);
   assert.equal(result.selectMid.logical,true);assert.ok(result.selectMid.progress>0&&result.selectMid.progress<1,style+' select ease');assert.equal(result.selectMid.textScale,1);assert.equal(result.selectMid.aboveBackground,true);
   assert.deepEqual(result.selectClose,{logical:false,visible:true,mode:'none'});assert.ok(result.closing<result.selectMid.progress);assert.ok(result.reopened&&result.selectEnd);
   assert.deepEqual(result.closingDialog,{logical:false,visible:true});assert.ok(result.dialogMid>0&&result.dialogMid<1);assert.ok(result.dialogReopen);assert.deepEqual(result.closeEvents,['action','closed']);assert.deepEqual(result.closeEnd,{visible:false,events:['action','closed']});
   assert.ok(result.thumb>2&&result.thumb<26);assert.ok(result.checkAlpha>0&&result.checkAlpha<1);assert.ok(result.radioMid);
   assert.equal(result.progress.logical,100);assert.ok(result.progress.visual>0&&result.progress.visual<100);assert.equal(result.slide.logical,100);assert.ok(result.slide.visual>0&&result.slide.visual<100);assert.equal(result.direct,20);
   assert.ok(result.pageAlpha>0&&result.pageAlpha<1);assert.ok(result.rowAlphas.every(a=>a===1));assert.equal(result.scrollMid.logical,100);assert.ok(result.scrollMid.pivot<0&&result.scrollMid.pivot>-100);
   if(process.env.UI_CHAIN_MOTION_EVIDENCE){
    await page.evaluate(()=>{motionNodes.Select.adapter.view.open();motionNodes.Dialog.setState({open:false});motionFlush();motionNodes.Dialog.setState({open:true});motionStep(90);harness.app.render();});
    await page.screenshot({path:join(process.env.UI_CHAIN_MOTION_EVIDENCE,'motion-'+style+'-components.png')});
    await page.evaluate(()=>{motionNodes.Select.adapter.view.close();motionFlush();});
   }
  }
  // Compare at the same normalized time: differences must be structural,
  // not merely the same animation running at a different speed.
  const designs=await page.evaluate(()=>['playful','premium','corporate'].map(style=>{
   const selection=motionAPI.motionSelection(style,'components'),p=selection.profile;motionController.set(selection);motionFlush();
   const d=motionNodes.Dialog.adapter.view;d.close();motionFlush();d.open();motionStep(p.enterMs*.35);
   const dialog={scale:d.innerView.scale.x,x:d.innerView.x+d.options.width*d.innerView.scale.x/2,content:d.contentView.alpha,alpha:d.innerView.alpha};motionFlush();
   const select=motionNodes.Select.adapter.view;select.close();motionFlush();select.open();motionStep(p.enterMs*.35);const rows=select.rows.map(r=>({alpha:r.alpha,y:r.pivot.y}));select.close();motionFlush();
   const tabs=motionNodes.Tabs;tabs.setState({activeId:'a'});motionFlush();tabs.setState({activeId:'b'});motionStep(p.changeMs*.35);const page={x:tabs.adapter.switcher.pivot.x,y:tabs.adapter.switcher.pivot.y};
   const outgoing=tabs.adapter.switcher.views[0],crossfade={visible:outgoing.visible,mode:outgoing.eventMode,alpha:outgoing.alpha};motionFlush();
   tabs.setState({activeId:'a'});motionStep(30);tabs.setState({activeId:'b'});motionStep(30);tabs.setState({activeId:'a'});motionFlush();const settledPages=tabs.adapter.switcher.views.map(v=>({visible:v.visible,alpha:v.alpha}));
   const b=motionNodes.Button;b.adapter.view.onDown.emit();motionStep(p.pressMs);const button={scale:b.root.scale.x,y:b.root.pivot.y};b.adapter.view.onUp.emit();motionFlush();
   return{style,dialog,rows,page,button,crossfade,settledPages};
  }));
  const [popStyle,softStyle,slideStyle]=designs;
  assert.notEqual(popStyle.dialog.scale,1);assert.equal(softStyle.dialog.scale,1);assert.equal(slideStyle.dialog.scale,1);
  assert.equal(popStyle.dialog.x,0);assert.equal(softStyle.dialog.x,0);assert.ok(slideStyle.dialog.x>0);
  assert.ok(softStyle.dialog.content<softStyle.dialog.alpha);assert.equal(slideStyle.dialog.content,1);
  assert.ok(popStyle.rows[0].alpha>popStyle.rows[1].alpha);assert.ok(softStyle.rows.every(r=>r.y===0));assert.ok(slideStyle.rows.every(r=>r.alpha===1&&r.y>0));
  assert.notEqual(popStyle.page.y,0);assert.deepEqual(softStyle.page,{x:0,y:0});assert.ok(slideStyle.page.x<0);assert.equal(slideStyle.page.y,0);
  assert.ok(popStyle.button.scale<softStyle.button.scale);assert.equal(slideStyle.button.scale,1);assert.equal(slideStyle.button.y,-3);
  assert.equal(softStyle.crossfade.visible,true);assert.equal(softStyle.crossfade.mode,'none');assert.ok(softStyle.crossfade.alpha>0&&softStyle.crossfade.alpha<1);
  for(const design of designs)assert.deepEqual(design.settledPages,[{visible:true,alpha:1},{visible:false,alpha:1}]);
  const details=await page.evaluate(()=>['playful','premium','corporate'].map(style=>{
   const p=motionAPI.motionSelection(style).profile;motionController.set(motionAPI.motionSelection(style));motionStep(p.enterMs*.2);
   const staticRoots=['Text','Image','Container'].map(type=>({scale:motionNodes[type].root.scale.x,y:motionNodes[type].root.pivot.y}));motionFlush();
   const check=motionNodes.CheckBox;check.setState({checked:false});motionFlush();check.setState({checked:true});motionStep(p.changeMs*.2);
   const mark=check.adapter.view.views[1].children[1],markPose={scale:mark.scale.x,y:mark.pivot.y};motionFlush();
   const list=motionNodes.List;list.setState({selectedId:'a'});motionFlush();list.setState({selectedId:'b'});motionStep(p.changeMs*.2);
   const row=list.adapter.rows[1].view??list.adapter.rows[1],rowPose={x:row.pivot.x,y:row.pivot.y};motionFlush();
   const input=motionNodes.Input;harness.runtime.focus(null);motionStep();harness.runtime.focus(input,false);motionStep(p.focusMs*.2);const focusAlpha=!!input.focusRing;harness.runtime.focus(null);motionFlush();
   const bar=motionNodes.ProgressBar;bar.setState({value:0});motionFlush();bar.setState({value:100});motionStep(p.changeMs*.2);const fill=bar.adapter.bar.progress;motionFlush();
   const slider=motionNodes.Slider;slider.adapter.view.onThumbPressed(true);motionStep(p.pressMs);const thumbAlpha=slider.adapter.view.slider1.children[0].alpha,thumbLift=slider.adapter.view.slider1.children[0].pivot.y*slider.adapter.view.slider1.children[0].scale.y;
   slider.setState({value:37});motionStep();const direct=slider.adapter.view.progress;slider.adapter.view.onThumbPressed(false);motionFlush();
   const stable={rowX:row.pivot.x,rowY:row.pivot.y,markY:mark.pivot.y,focus:!!input.focusRing,thumb:slider.adapter.view.slider1.children[0].alpha};
   return {staticRoots,markPose,rowPose,focusAlpha,fill,thumbAlpha,thumbLift,direct,stable};
  }));
  for(const d of details){assert.ok(d.staticRoots.every(r=>r.scale===1));assert.equal(d.direct,37);assert.deepEqual(d.stable,{rowX:0,rowY:0,markY:0,focus:false,thumb:1});assert.ok(d.fill>0&&d.fill<100);}
  assert.ok(details[0].staticRoots.every(r=>r.y!==0));assert.ok(details[1].staticRoots.every(r=>r.y===0));assert.ok(details[2].staticRoots.every(r=>r.y!==0));
  assert.ok(details[0].rowPose.y!==0&&details[0].rowPose.x===0);assert.deepEqual(details[1].rowPose,{x:0,y:0});assert.ok(details[2].rowPose.x!==0&&details[2].rowPose.y===0);
  assert.equal(details[1].markPose.y,0);assert.ok(details[2].markPose.y<0);assert.notEqual(details[0].markPose.scale,details[1].markPose.scale);
  assert.ok(details[0].fill>details[2].fill&&details[2].fill>details[1].fill,'bounded values use distinct ease-out, linear and ease-in-out curves');
  assert.ok(details.every(d=>d.thumbAlpha===1));assert.deepEqual(details.map(d=>d.thumbLift),[3,2,1]);
  assert.ok(details.every(d=>d.focusAlpha===false));
  const selectPoint=await page.evaluate(()=>{motionController.set(motionAPI.motionSelection('premium'));motionFlush();harness.app.render();const b=motionNodes.Select.adapter.view.openButton.getBounds();return{x:b.x+b.width/2,y:b.y+b.height/2};});
  await page.mouse.click(selectPoint.x,selectPoint.y);
  assert.equal(await page.evaluate(()=>{motionStep(60);return motionNodes.Select.adapter.view.expanded&&motionNodes.Select.adapter.view.motionProgress>0&&motionNodes.Select.adapter.view.motionProgress<1;}),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>motionNodes.Select.adapter.view.expanded),true);
  await page.mouse.click(selectPoint.x,selectPoint.y);
  assert.deepEqual(await page.evaluate(()=>{const v=motionNodes.Select.adapter.view,mid={expanded:v.expanded,visible:v.view.visible,focus:!!motionNodes.Select.focusRing?.visible};motionFlush();return {...mid,end:v.view.visible};}),{expanded:false,visible:true,focus:false,end:false});
  assert.deepEqual(await page.evaluate(()=>Object.values(motionNodes).map(h=>h.snapshot())),before);
  // Right-aligned switches must stay relative to their track, including after layout changes.
  const alignedSwitch=await page.evaluate(()=>{
   motionController.dispose();const sw=motionNodes.Switch,views=sw.adapter.view.views,initial=sw.readState().checked;
   const shift=x=>views.forEach(v=>{const delta=x-v.children[0].x;v.children[0].x=x;v.children[1].x+=delta;});
   shift(300);motionController=motionAPI.attachComponentMotion(motionWin,motionAPI.motionSelection('playful'));motionFlush();
   const poses=()=>views.map(v=>v.children[1].x-v.children[0].x);
   const original=poses();sw.setState({checked:!initial});motionStep(80);const mid=poses();motionFlush();const settled=poses();
   shift(420);sw.setState({checked:initial});motionStep(80);const resized=poses();motionFlush();
   motionController.set(motionAPI.motionSelection('original'));const reset=poses();shift(0);
   return {original,mid,settled,resized,reset};
  });
  assert.deepEqual(alignedSwitch.original,[2,26]);assert.deepEqual(alignedSwitch.settled,[2,26]);assert.deepEqual(alignedSwitch.reset,[2,26]);
  for(const values of [alignedSwitch.mid,alignedSwitch.resized])assert.ok(values.every(x=>x>2&&x<26));
  const interruptedButton=await page.evaluate(()=>{
   motionController.set(motionAPI.motionSelection('playful'));motionFlush();const b=motionNodes.Button;
   b.adapter.view.onDown.emit();motionStep(65);const pressed=b.root.scale.x;
   b.setEnabled(false);motionStep();const disabled={scale:b.root.scale.x,x:b.root.pivot.x,y:b.root.pivot.y};
   b.setEnabled(true);const size={...b.size};b.adapter.view.onDown.emit();motionStep(65);b.resize(size.width+40,size.height);motionStep();
   const resized={scale:b.root.scale.x,x:b.root.pivot.x,y:b.root.pivot.y};b.resize(size.width,size.height);motionFlush();return {pressed,disabled,resized};
  });
  assert.ok(interruptedButton.pressed<1);assert.deepEqual(interruptedButton.disabled,{scale:1,x:0,y:0});assert.deepEqual(interruptedButton.resized,{scale:1,x:0,y:0});
  const safety=await page.evaluate(()=>{
   const v=motionNodes.Select.adapter.view;v.open();motionStep(40);v.close();motionController.set(motionAPI.motionSelection('original'));const original=!v.view.visible&&motionController.inspect().running===0;
   motionController.set(motionAPI.motionSelection('playful'));motionFlush();v.open();motionStep(30);motionMedia.matches=true;motionStep();const reduced=v.motionProgress===1&&motionController.inspect().running===0;v.close();const immediate=!v.view.visible;motionMedia.matches=false;
   v.open();motionStep(30);motionNodes.Select.resize(350,50);motionStep();const resized=v.motionProgress===1;v.close();motionStep(30);motionController.dispose();const disposed=!v.view.visible&&v.motionDriver===null;
   return{original,reduced,immediate,resized,disposed};
  });assert.deepEqual(safety,{original:true,reduced:true,immediate:true,resized:true,disposed:true});
  const sparseInventory=await page.evaluate(()=>{
   harness.clear();harness.runtime.registry.recipes=motionAPI.upgradeInventoryRegistry(harness.runtime.registry).recipes;const n=harness.make('List',{size:{width:600,height:400},props:{items:[{id:'last',label:'Last',enabled:true,slotIndex:5,quantity:1,description:'Last slot',icon:null}],selectedId:null,inventory:{columns:3,rows:2,gap:8,details:'below',appearance:'slots',cellSize:64,initialSlot:0,scrollMode:'fixed-cells-both-v1'}}});
   motionWin.studioCanvas.items=[{n}];motionWin.studioCanvas.h.runtime=harness.runtime;motionController=motionAPI.attachComponentMotion(motionWin,motionAPI.motionSelection('playful'));motionFlush();
   n.setState({selectedId:'last'});motionStep(40);const alphas=n.adapter.cells.map(c=>c.view.alpha);motionFlush();const selected=n.readState().selectedId;
   motionController.dispose();return {alphas,selected};
  });
  assert.equal(sparseInventory.selected,'last');assert.equal(sparseInventory.alphas[0],1);assert.ok(sparseInventory.alphas[5]<1);
  // A modal retains its blocker during exit; reopen cancels removal without duplicate events.
  const modal=await page.evaluate(()=>{
   harness.clear();const d=harness.make('Dialog',{props:{modal:true},size:{height:180}});window.motionModal=d;motionWin.studioCanvas.items=[{n:d}];motionWin.studioCanvas.h.runtime=harness.runtime;window.motionController=motionAPI.attachComponentMotion(motionWin,motionAPI.motionSelection('premium'));motionFlush();harness.events.length=0;
   d.adapter.view.close();motionStep(60);const mid={open:d.readState().open,visible:d.adapter.view.visible,blockers:harness.runtime.overlay.modals.length};d.setState({open:true});motionFlush();const reopen=harness.runtime.overlay.modals.length===1;d.adapter.view.close();motionFlush();return{mid,reopen,end:harness.runtime.overlay.modals.length,events:harness.events.map(e=>e.event)};
  });assert.deepEqual(modal,{mid:{open:false,visible:true,blockers:1},reopen:true,end:0,events:['closed','closed']});
  if(process.env.UI_CHAIN_MOTION_EVIDENCE){
   await page.evaluate(()=>{motionModal.setState({open:true});motionStep(100);harness.app.render();});await page.screenshot({path:join(process.env.UI_CHAIN_MOTION_EVIDENCE,'motion-dialog-mid.png')});
  }
  await page.evaluate(()=>{motionController.dispose();harness.clear();});assert.deepEqual(env.errors,[]);
 }finally{await env.close();}
});
