import {test,expect,type Page} from '@playwright/test';
import {createBundle} from '../../src/bundle.ts';
import {writeFile} from 'node:fs/promises';
async function load(page:Page,zero=false){
 const style={backgroundColor:'#EDF4FF',borderColor:'#204060',borderWidth:1,cornerRadius:0,textColor:'#102030',fontFamily:'Arial',fontSize:18,fontWeight:'normal',opacity:1};
 const inner={id:'inner',type:'ScrollView',layout:{x:20,y:20,width:300,height:200},props:{style,scrollX:0,scrollY:0,contentWidth:zero?300:900,contentHeight:zero?200:800},children:[{id:'text',type:'Text',layout:{x:0,y:0,width:900,height:800},props:{style,text:Array.from({length:24},(_,i)=>'ROW '+i+' — WHEEL UNIT FIXTURE').join('\n'),wrap:'none',overflow:'clip',lineHeight:30}}]};
 const document:any={schemaVersion:'0.2',id:'wheel-units',canvas:{width:640,height:480},root:{id:'outer',type:'ScrollView',layout:{x:0,y:0,width:640,height:480},props:{style,scrollX:0,scrollY:0,contentWidth:1000,contentHeight:1000},children:[inner]}};
 const bundle=await createBundle(document,[],{kind:'programmatic-fixture',description:'Local deterministic wheel deltaMode integration fixture. Line/page events are synthetic, pixel wheel is real browser input.'});
 await page.goto('/');await page.locator('#open-bundle').setInputFiles({name:'wheel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();
 const snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 const value=async(id='inner')=>(await snapshot()).inspection.nodes.find(n=>n.id===id)?.value;
 const events=async()=>(await snapshot()).events.filter(e=>e.type==='scroll');
 const point=async()=>{const b=await canvas.boundingBox();if(!b)throw Error('canvas');return{x:b.x+100*b.width/640,y:b.y+100*b.height/480};};
 const simulated=async(mode:number,x:number,y:number)=>{const p=await point();return canvas.evaluate((canvas,d)=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:d.p.x,clientY:d.p.y,deltaMode:d.mode,deltaX:d.x,deltaY:d.y});const accepted=canvas.dispatchEvent(e);return {isTrusted:e.isTrusted,defaultPrevented:e.defaultPrevented,accepted};},{mode,x,y,p});};
 return {canvas,snapshot,value,events,point,simulated};
}
test('real pixel wheel retains values and prevents outer/page scrolling',async({page},info)=>{
 const f=await load(page);const p=await f.point();await page.mouse.move(p.x,p.y);const pageY=await page.evaluate(()=>scrollY);
 const before=await f.canvas.screenshot({path:info.outputPath('before.png')});await page.mouse.wheel(25,35);await expect.poll(()=>f.value()).toEqual({x:25,y:35});
 expect(await f.value('outer')).toEqual({x:0,y:0});expect(await f.events()).toHaveLength(1);expect(await page.evaluate(()=>scrollY)).toBe(pageY);
 expect((await f.canvas.screenshot({path:info.outputPath('pixel-after.png')})).equals(before)).toBe(false);await page.mouse.wheel(-25,-35);await expect.poll(()=>f.value()).toEqual({x:0,y:0});expect(await f.events()).toHaveLength(2);
 await writeFile(info.outputPath('evidence.json'),JSON.stringify({input:'real browser mouse wheel',human_visual_acceptance:false,view:await f.snapshot()},null,2));
});
test('synthetic standard line/page events traverse real Pixi hits and clamp once',async({page},info)=>{
 const f=await load(page);const checks:any[]=[];
 const step=async(mode:number,x:number,y:number,expected:any,changes:number)=>{const count=(await f.events()).length;const dispatch=await f.simulated(mode,x,y);expect(dispatch).toEqual({isTrusted:false,defaultPrevented:true,accepted:false});expect(await f.value()).toEqual(expected);expect(await f.events()).toHaveLength(count+changes);expect(await f.value('outer')).toEqual({x:0,y:0});checks.push({mode,x,y,expected,dispatch,events:await f.events()});};
 const before=await f.canvas.screenshot({path:info.outputPath('before.png')});
 await step(1,2,3,{x:80,y:120},1);const line=await f.canvas.screenshot({path:info.outputPath('line-after.png')});expect(line.equals(before)).toBe(false);
 expect((await f.snapshot()).inspection.nodes.find(n=>n.id==='text')?.bounds.y).toBe(-100);
 await step(2,1,1,{x:380,y:320},1);expect((await f.canvas.screenshot({path:info.outputPath('page-after.png')})).equals(line)).toBe(false);
 expect((await f.snapshot()).inspection.nodes.find(n=>n.id==='text')?.bounds.y).toBe(-300);
 await step(2,10,10,{x:600,y:600},1);await step(2,1,1,{x:600,y:600},0);
 await step(1,-0.5,-0.25,{x:580,y:590},1);await step(2,-10,-10,{x:0,y:0},1);await step(1,-1,-1,{x:0,y:0},0);
 await step(0,0.5,0.25,{x:0.5,y:0.25},1);
 const count=(await f.events()).length;await f.simulated(3,1,1);expect(await f.value()).toEqual({x:0.5,y:0.25});expect(await f.events()).toHaveLength(count);
 await writeFile(info.outputPath('evidence.json'),JSON.stringify({input:'synthetic untrusted DOM WheelEvent; actual Pixi dispatch/rendering',human_visual_acceptance:false,checks,view:await f.snapshot()},null,2));
});
test('zero-range inner ScrollView contains every wheel unit without fake events',async({page},info)=>{
 const f=await load(page,true);for(const mode of [0,1,2])for(const sign of [-1,1]){const d=await f.simulated(mode,sign,sign);expect(d.defaultPrevented).toBe(true);expect(await f.value()).toEqual({x:0,y:0});expect(await f.value('outer')).toEqual({x:0,y:0});expect(await f.events()).toHaveLength(0);}
 await f.canvas.screenshot({path:info.outputPath('zero-range.png')});
 await writeFile(info.outputPath('evidence.json'),JSON.stringify({input:'synthetic line/page/pixel boundary events',human_visual_acceptance:false,view:await f.snapshot()},null,2));
});
