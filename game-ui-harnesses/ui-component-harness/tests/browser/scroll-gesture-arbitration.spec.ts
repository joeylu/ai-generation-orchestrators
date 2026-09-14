import {test,expect,type Page} from '@playwright/test';
import {createBundle} from '../../src/bundle.ts';
import {writeFile} from 'node:fs/promises';

const style={backgroundColor:'#EFF4FF',borderColor:'#3C5B91',borderWidth:1,cornerRadius:0,textColor:'#102040',fontFamily:'Arial',fontSize:16,fontWeight:'normal',opacity:1};
async function load(page:Page,kind='list',height=600){
 const list=(id:string)=>({id,type:'List',layout:{x:0,y:0,width:400,height:600},props:{style,enabled:true,selectedId:'r2',itemHeight:100,itemTemplate:'text-row',items:Array.from({length:6},(_,i)=>({id:'r'+i,label:'Row '+i}))},children:[]});
 const scroll:any={id:'scroll',type:'ScrollView',layout:{x:20,y:20,width:400,height:280},props:{style,scrollX:0,scrollY:0,contentWidth:400,contentHeight:height,scrollbarVisibility:'always',appearance:{sourceCanvas:{width:400,height:280},viewport:{image:'viewport.svg',canvas:{width:400,height:280},layout:{x:0,y:0,width:400,height:280}},scrollbarTrack:{image:'track.svg',canvas:{width:20,height:280},layout:{x:380,y:0,width:20,height:280}},scrollbarThumbImage:'thumb.svg',scrollbarThumbCanvas:{width:10,height:20},scrollbarThumbPositions:{min:{x:385,y:20},max:{x:385,y:240}},scrollbarInsets:{version:'1.0',top:20,bottom:20}}},children:[list('list')]};
 if(kind==='controls')scroll.children=[
  {id:'button',type:'Button',layout:{x:20,y:50,width:250,height:60},props:{style,enabled:true,label:'Press or drag'},children:[]},
  {id:'check',type:'CheckBox',layout:{x:20,y:130,width:250,height:50},props:{style,enabled:true,label:'Check or drag',checked:false}},
  {id:'slider',type:'Slider',layout:{x:20,y:200,width:250,height:40},props:{style,enabled:true,value:40,min:0,max:100,step:1}},
 ];
 if(kind==='nested')scroll.children=[{id:'inner',type:'ScrollView',layout:{x:0,y:0,width:300,height:200},props:{style,scrollX:0,scrollY:0,contentWidth:400,contentHeight:600},children:[list('list')]}];
 const document:any={schemaVersion:'0.2',id:'scroll-arbitration',canvas:{width:640,height:480},root:{id:'root',type:'Container',layout:{x:0,y:0,width:640,height:480},props:{style},children:[scroll]}};
 const resources=[['viewport',400,280,'#EFF4FF'],['track',20,280,'#203060'],['thumb',10,20,'#00AA99']].map(([name,w,h,color])=>({path:name+'.svg',mime:'image/svg+xml',bytes:new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color}"/></svg>`)}));
 const bundle=await createBundle(document,resources,{kind:'programmatic-fixture',description:'Deterministic ScrollView gesture arbitration, child controls and overlapping scrollbar hit coverage.'});
 await page.goto('/');await page.locator('#open-bundle').setInputFiles({name:'scroll.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();
 const at=async(x:number,y:number)=>{const b=await canvas.boundingBox();if(!b)throw Error('canvas');return [b.x+x*b.width/640,b.y+y*b.height/480] as const;};
 const move=async(x:number,y:number)=>page.mouse.move(...await at(x,y),{steps:6});
 const click=async(x:number,y:number)=>page.mouse.click(...await at(x,y));
 const drag=async(x:number,y:number,endX:number,endY:number)=>{await move(x,y);await page.mouse.down();await move(endX,endY);await page.mouse.up();};
 const snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 const value=async(id:string)=>(await snapshot()).inspection.nodes.find(n=>n.id===id)?.value;
 const events=async(id:string,type:string)=>(await snapshot()).events.filter(e=>e.id===id&&e.type===type);
 const set=async(y:number)=>{await page.evaluate(y=>window.uiStudio.setValue('scroll',{x:0,y}),y);await page.waitForTimeout(250);};
 return {canvas,at,move,click,drag,snapshot,value,events,set};
}

test('content drag, click slop and scrollbar hits preserve List selection',async({page},info)=>{
 const f=await load(page);await f.canvas.screenshot({path:info.outputPath('before.png')});
 await f.drag(100,90,100,30);expect(await f.value('scroll')).toEqual({x:0,y:60});expect(await f.value('list')).toBe('r2');expect(await f.events('list','change')).toHaveLength(0);expect(await f.events('scroll','scroll')).toHaveLength(1);
 await f.canvas.screenshot({path:info.outputPath('drag-no-selection.png')});
 await f.set(0);
 // Under six CSS pixels: ordinary click, with no incidental pan.
 await f.move(100,90);const p=await f.at(100,90);await page.mouse.down();await page.mouse.move(p[0]+2,p[1]+2);await page.mouse.up();
 expect(await f.value('scroll')).toEqual({x:0,y:0});expect(await f.value('list')).toBe('r0');expect(await f.events('list','change')).toHaveLength(1);
 await f.click(100,240);expect(await f.value('list')).toBe('r2');
 const changes=(await f.events('list','change')).length;
 // The list deliberately extends below the painted scrollbar.
 await f.drag(410,65,410,125);expect((await f.value('scroll') as any).y).toBeGreaterThan(0);expect(await f.events('list','change')).toHaveLength(changes);
 await f.click(410,25);expect(await f.events('list','change')).toHaveLength(changes);
 const y=(await f.value('scroll') as any).y;await f.drag(410,25,410,60);expect((await f.value('scroll') as any).y).toBe(y);
 await f.click(100,260);expect(await f.events('list','change')).toHaveLength(changes+1);
 await f.canvas.screenshot({path:info.outputPath('after-click.png')});await writeFile(info.outputPath('events.json'),JSON.stringify(await f.snapshot(),null,2));
});

test('CSS-scale click threshold does not introduce a thumb dead zone',async({page},info)=>{
 const f=await load(page);await f.canvas.evaluate(canvas=>{canvas.style.width='320px';canvas.style.height='240px';});
 const start=await f.at(100,90);await page.mouse.move(...start);await page.mouse.down();await page.mouse.move(start[0],start[1]-3);await page.mouse.up();
 expect(await f.value('scroll')).toEqual({x:0,y:0});expect(await f.value('list')).toBe('r0');
 await f.click(100,240);const next=await f.at(100,90);await page.mouse.move(...next);await page.mouse.down();await page.mouse.move(next[0],next[1]-8);await page.mouse.up();
 expect(await f.value('scroll')).toEqual({x:0,y:16});expect(await f.value('list')).toBe('r2');
 await f.set(0);const thumb=await f.at(410,65);await page.mouse.move(...thumb);await page.mouse.down();await page.mouse.move(thumb[0],thumb[1]+1);await page.mouse.up();
 expect((await f.value('scroll') as any).y).toBeGreaterThan(0);expect(await f.value('list')).toBe('r2');
 await f.canvas.screenshot({path:info.outputPath('scaled-thumb.png')});
});

test('child press yields to content drag; Slider keeps its own gesture',async({page},info)=>{
 const f=await load(page,'controls');
 await f.drag(100,100,100,60);expect(await f.value('scroll')).toEqual({x:0,y:40});expect(await f.events('button','activate')).toHaveLength(0);expect(await f.events('button','cancel')).toHaveLength(1);
 await f.click(100,60);expect(await f.events('button','activate')).toHaveLength(1);
 await f.set(0);await f.drag(100,170,100,130);expect(await f.value('check')).toBe(false);expect(await f.events('check','change')).toHaveLength(0);await f.click(100,130);expect(await f.value('check')).toBe(true);expect(await f.events('check','change')).toHaveLength(1);
 await f.set(0);const n=(await f.events('scroll','scroll')).length;await f.drag(140,240,260,220);expect(await f.value('scroll')).toEqual({x:0,y:0});expect(await f.value('slider')).toBeGreaterThan(40);expect(await f.events('slider','change')).toHaveLength(1);expect(await f.events('scroll','scroll')).toHaveLength(n);
 await f.canvas.screenshot({path:info.outputPath('child-controls.png')});await writeFile(info.outputPath('events.json'),JSON.stringify(await f.snapshot(),null,2));
});

test('cancel, outside release, programmatic ownership and zero-range drag',async({page},info)=>{
 const f=await load(page);
 await f.move(100,100);await page.mouse.down();await f.move(100,40);expect(await f.value('scroll')).toEqual({x:0,y:60});await page.keyboard.press('Escape');await page.mouse.up();expect(await f.value('scroll')).toEqual({x:0,y:0});expect(await f.events('list','change')).toHaveLength(0);expect(await f.events('scroll','scroll')).toHaveLength(0);
 await f.move(100,100);await page.mouse.down();await f.move(100,40);await f.set(17);await f.move(100,30);await page.mouse.up();expect(await f.value('scroll')).toEqual({x:0,y:17});expect(await f.events('list','change')).toHaveLength(0);expect(await f.events('scroll','scroll')).toHaveLength(1);
 await f.set(0);await f.drag(100,100,500,5);expect((await f.value('scroll') as any).y).toBe(95);expect(await f.events('list','change')).toHaveLength(0);
 await f.set(0);await f.move(100,100);await page.mouse.down();await f.move(100,40);await page.mouse.wheel(0,20);await expect.poll(async()=>(await f.value('scroll') as any).y).toBe(20);await f.move(100,30);await page.mouse.up();expect(await f.value('scroll')).toEqual({x:0,y:20});expect(await f.events('list','change')).toHaveLength(0);
 const z=await load(page,'list',280);await z.drag(100,90,100,30);expect(await z.value('scroll')).toEqual({x:0,y:0});expect(await z.value('list')).toBe('r2');expect(await z.events('scroll','scroll')).toHaveLength(0);await z.click(100,60);expect(await z.value('list')).toBe('r0');
 await z.canvas.screenshot({path:info.outputPath('zero-range-click.png')});
});

test('nearest nested ScrollView owns drag and wheel, without page leakage',async({page},info)=>{
 const f=await load(page,'nested');await f.drag(100,100,100,40);expect(await f.value('inner')).toEqual({x:0,y:60});expect(await f.value('scroll')).toEqual({x:0,y:0});expect(await f.value('list')).toBe('r2');expect(await f.events('scroll','scroll')).toHaveLength(0);
 const pageY=await page.evaluate(()=>scrollY);await f.move(100,100);await page.mouse.wheel(0,800);await expect.poll(async()=>(await f.value('inner') as any).y).toBe(400);await page.mouse.wheel(0,800);await page.waitForTimeout(100);expect(await page.evaluate(()=>scrollY)).toBe(pageY);expect(await f.value('scroll')).toEqual({x:0,y:0});expect(await f.events('inner','scroll')).toHaveLength(2);
 await f.canvas.screenshot({path:info.outputPath('nested.png')});await writeFile(info.outputPath('events.json'),JSON.stringify(await f.snapshot(),null,2));
});
