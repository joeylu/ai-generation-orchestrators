import { test, expect } from '@playwright/test';
import { switchStateImagesFixture } from '../helpers/switch-state-images-fixture.ts';
import { applyAppearanceBinding } from '../../src/appearance-apply.ts';
test('Studio mouse and keyboard switch both textures, retain values/events, save and reopen', async({page},info)=>{
 const f=await switchStateImagesFixture(),bundle=structuredClone(await applyAppearanceBinding(f.target,f.imported,f.binding));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('/');await page.locator('#open-bundle').setInputFiles({name:'switch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
 await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();
 const read=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
 const pixel=async(bytes:Buffer,x:number,y:number)=>page.evaluate(async({data,x,y})=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(Math.floor(x*image.width/500),Math.floor(y*image.height/400),1,1).data];},{data:bytes.toString('base64'),x,y});
 const off=await canvas.screenshot({path:info.outputPath('off.png')});
 expect(await pixel(off,100,106)).toEqual([48,105,70,255]);expect(await pixel(off,30,90)).toEqual([246,243,231,255]);
 const b=await canvas.boundingBox();if(!b)throw Error('canvas missing');
 await page.mouse.click(b.x+100*b.width/500,b.y+90*b.height/400);
 let v=await read();expect(v.inspection.nodes.find(n=>n.id==='apply-switch')?.value).toBe(true);expect(v.events.some(e=>e.id==='apply-switch'&&e.type==='change'&&e.source==='mouse'&&e.value===true)).toBe(true);
 const on=await canvas.screenshot({path:info.outputPath('on.png')});expect(on.equals(off)).toBe(false);expect(await pixel(on,100,106)).toEqual([0,180,250,255]);expect(await pixel(on,170,90)).toEqual([255,60,100,255]);
 // Read pixels well outside the moving thumb and inside the ON thumb to prove both textures.
 const pixels=await page.evaluate(async()=>{const bundle=await window.uiStudio.exportSelected();const n:any=(bundle.document as any).root.children[1];return n.props.appearance.stateImages;});expect(pixels.on.trackImage).not.toBe(pixels.off.trackImage);expect(pixels.on.thumbImage).not.toBe(pixels.off.thumbImage);
 await canvas.focus();for(let i=0;i<8 && await canvas.getAttribute('data-focused-component')!=='apply-switch';i++)await page.keyboard.press('Tab');
 await expect(canvas).toHaveAttribute('data-focused-component','apply-switch');await page.keyboard.press('Space');
 v=await read();expect(v.inspection.nodes.find(n=>n.id==='apply-switch')?.value).toBe(false);expect(v.events.some(e=>e.id==='apply-switch'&&e.type==='change'&&e.source==='keyboard'&&e.value===false)).toBe(true);
 const restored=await canvas.screenshot({path:info.outputPath('off-restored.png')});
 expect(await pixel(restored,100,106)).toEqual([48,105,70,255]);expect(await pixel(restored,30,90)).toEqual([246,243,231,255]);
 const saved=await page.evaluate(()=>window.uiStudio.exportSelected());await page.reload();await page.locator('#open-bundle').setInputFiles({name:'reopened.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 expect(await page.evaluate(()=>window.uiStudio.exportSelected())).toEqual(saved);expect(errors).toEqual([]);
});


test('runtime rejects wrong state image dimensions before rendering',async({page})=>{
 const f=await switchStateImagesFixture(),bundle=structuredClone(await applyAppearanceBinding(f.target,f.imported,f.binding));
 const n:any=(bundle.document as any).root.children[1];n.props.appearance.stateImages.on.thumbImage=n.props.appearance.stateImages.on.trackImage;
 await page.goto('/workbench.html');await page.waitForFunction(()=>Boolean(window.uiHarness));
 const result=await page.evaluate(async b=>{try{await window.uiHarness.importBundle(b);return 'unexpected success';}catch(error){return String(error);}},bundle);
 expect(result).toContain('SWITCH_STATE_IMAGE_SIZE_MISMATCH');
});
