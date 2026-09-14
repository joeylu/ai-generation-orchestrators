import {test,expect} from '@playwright/test';
import {createBundle} from '../../src/bundle.ts';

test('Studio always-visible zero-range scrollbar paints and real inputs emit no scroll',async({page})=>{
 const style={backgroundColor:'#FFFFFF',borderColor:'#000000',borderWidth:0,cornerRadius:0,textColor:'#000000',fontFamily:'Arial',fontSize:12,fontWeight:'normal',opacity:1};
 const document={schemaVersion:'0.2',id:'zero-scroll',canvas:{width:300,height:300},root:{id:'scroll',type:'ScrollView',layout:{x:0,y:0,width:300,height:300},props:{style,scrollX:0,scrollY:0,contentWidth:300,contentHeight:300,scrollbarVisibility:'always',appearance:{sourceCanvas:{width:300,height:300},viewport:{image:'view.svg',canvas:{width:300,height:300},layout:{x:0,y:0,width:300,height:300}},scrollbarTrack:{image:'track.svg',canvas:{width:20,height:260},layout:{x:260,y:20,width:20,height:260}},scrollbarThumbImage:'thumb.svg',scrollbarThumbCanvas:{width:10,height:20},scrollbarThumbPositions:{min:{x:265,y:20},max:{x:265,y:260}}}},children:[]}};
 const resources=[['view',300,300,'white'],['track',20,260,'blue'],['thumb',10,20,'red']].map(([id,w,h,color])=>({path:id+'.svg',mime:'image/svg+xml',bytes:new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color}"/></svg>`)}));
 const bundle=await createBundle(document,resources,{kind:'programmatic-fixture',description:'Local no-overflow visibility and no-op input regression.'});
 await page.goto('/');await page.locator('#open-bundle').setInputFiles({name:'zero.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
 await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();if(!box)throw Error('canvas');
 const at=(x:number,y:number)=>[box.x+x*box.width/300,box.y+y*box.height/300] as const;
 const png=await canvas.screenshot();const colors=await page.evaluate(async base64=>{const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const c=document.createElement('canvas');c.width=300;c.height=300;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0,300,300);return [[262,150],[270,30],[270,270]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));},png.toString('base64'));
 expect(colors).toEqual([[0,0,255,255],[255,0,0,255],[255,0,0,255]]);
 await page.mouse.move(...at(270,150));await page.mouse.wheel(0,1000);await page.mouse.wheel(0,-1000);
 for(const y of [5,295]){await page.mouse.move(...at(270,150));await page.mouse.down();await page.mouse.move(...at(270,y),{steps:8});await page.mouse.up();}
 await page.keyboard.press('Tab');
 expect((await page.evaluate(()=>window.uiStudio.snapshot().views[0])).events.filter(e=>e.type==='focus').at(-1)?.id).toBe('scroll');
 await page.keyboard.press('End');await page.keyboard.press('Home');await page.waitForTimeout(200);
 const view=await page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 expect(view.inspection.nodes.find(n=>n.id==='scroll')?.value).toEqual({x:0,y:0});expect(view.events.filter(e=>e.id==='scroll'&&e.type==='scroll')).toEqual([]);
});
