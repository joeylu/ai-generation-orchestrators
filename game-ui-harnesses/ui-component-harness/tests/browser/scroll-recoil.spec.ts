import {test,expect} from '@playwright/test';import {fixture} from '../helpers/scrollbar-insets-fixture.ts';import {applyAppearanceBinding} from '../../src/appearance-apply.ts';import {appearanceDocumentSha256} from '../../src/appearance-binding.ts';
test('style edge recoil changes paint without fake scroll events or thumb movement',async({page},info)=>{
 const f=await fixture();f.target=structuredClone(f.target);const n:any=(f.target.document as any).root.children[0].children[0];n.props.contentHeight=140;n.props.scrollbarVisibility='always';n.children=[{id:'content',type:'Text',layout:{x:0,y:0,width:90,height:140},props:{text:'ONE\nTWO\nTHREE\nFOUR\nFIVE',drawBackground:false,wrap:'word',overflow:'clip',lineHeight:26,style:n.props.style}}];f.binding.documentSha256=await appearanceDocumentSha256(f.target.document);f.binding.bindings[0].states.scrollView.scrollbarInsets={version:'1.0',top:20,bottom:20};const bundle=await applyAppearanceBinding(f.target,f.imported,f.binding);
 await page.clock.install();
 await page.goto('/');
 for(const style of ['original','playful','premium','corporate']){
 await page.locator('#open-bundle').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);if(style!=='original')await page.locator('#scheme-options [data-scheme="'+style+'"]').click();await page.waitForTimeout(1000);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();if(!b)throw Error('canvas');await page.mouse.move(b.x+80*b.width/300,b.y+90*b.height/250);await page.waitForTimeout(16);await page.mouse.wheel(0,20);await page.waitForTimeout(32);await expect.poll(()=>page.evaluate(()=>(window.uiStudio.snapshot().views[0].document as any).root.children[0].children[0].props.scrollY)).toBe(20);await page.waitForTimeout(600);
 const snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);const first=await snapshot();expect((first.document as any).root.children[0].children[0].props.scrollY).toBe(20);const baseline=await canvas.screenshot();
 const pageY=await page.evaluate(()=>window.scrollY);
 // Freeze the browser clock only for transient pixel capture; input remains native.
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));
 await page.mouse.wheel(0,20);await page.clock.runFor(112);const middle=await canvas.screenshot({path:info.outputPath(style+'-edge.png')});const mid=await snapshot();expect(mid.events.length).toBe(first.events.length);expect((mid.document as any).root.children[0].children[0].props.scrollY).toBe(20);
 expect(mid.inspection.paintRegions?.filter(r=>r.componentId==='scroll')).toEqual(first.inspection.paintRegions?.filter(r=>r.componentId==='scroll'));
 expect(middle.equals(baseline)).toBe(style==='original'||style==='corporate');await page.clock.runFor(500);const settled=await snapshot();expect(settled.motionSnapshot!.nodes.find(n=>n.id==='scroll')!.presentation.scrollRecoil??0).toBe(0);await canvas.screenshot({path:info.outputPath(style+'-settled.png')});
 expect(await page.evaluate(()=>window.scrollY)).toBe(pageY);await page.clock.resume();
 // Real thumb drag from bottom to top; release must produce style feedback.
 const d=await canvas.boundingBox();if(!d)throw Error("canvas"); await page.mouse.move(d.x+147*d.width/300,d.y+100*d.height/250);
 await page.mouse.down();await page.mouse.move(d.x+147*d.width/300,d.y+66*d.height/250,{steps:5});
 expect(((await snapshot()).document as any).root.children[0].children[0].props.scrollY).toBe(0);
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));
 await page.mouse.up();await page.clock.runFor(100);
 const released=await snapshot();
 expect(Math.abs(released.motionSnapshot!.nodes.find(n=>n.id==='scroll')!.presentation.scrollRecoil??0)>0).toBe(style==='playful'||style==='premium');
 await canvas.screenshot({path:info.outputPath(style+'-drag-release.png')});
 expect(released.events.some(e=>e.type==='scroll'&&e.source==='mouse')).toBe(true);
 await page.clock.runFor(500);
 expect((await snapshot()).motionSnapshot!.nodes.find(n=>n.id==='scroll')!.presentation.scrollRecoil??0).toBe(0);
 await page.clock.resume();
 }
 const before=await page.evaluate(()=>window.scrollY);await page.mouse.move(10,100);await page.mouse.wheel(0,150);await page.waitForTimeout(200);expect(await page.evaluate(()=>window.scrollY)).not.toBe(before);
});
