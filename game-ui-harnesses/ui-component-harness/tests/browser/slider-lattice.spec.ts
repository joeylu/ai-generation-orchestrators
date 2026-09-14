import {test,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
import {firstBatchAppearanceFixture} from '../helpers/first-batch-appearance-fixture.ts';
import {applyAppearanceBinding} from '../../src/appearance-apply.ts';
import {createBundle,validateBundle} from '../../src/bundle.ts';
import {isStepAligned} from '../../src/runtime-state.ts';

for(const spec of [
  {name:'fractional-origin',min:.5,max:4.5,step:1,value:2.5,end:4.5,next:1.5},
  {name:'non-lattice-end',min:0,max:10,step:4,value:4,end:8,next:4},
  {name:'scientific-step',min:0,max:1e-10,step:1e-11,value:5e-11,end:1e-10,next:1e-11},
])test(`raster Slider ${spec.name}: mouse, keyboard, boundary and saved bundle`,async({page},info)=>{
  const f=await firstBatchAppearanceFixture();const applied:any=await applyAppearanceBinding(f.target,f.imported,f.binding);
  const doc=structuredClone(applied.document);doc.root.children=doc.root.children.filter((n:any)=>n.type==='Slider');
  Object.assign(doc.root.children[0].props,{min:spec.min,max:spec.max,step:spec.step,value:spec.value});
  const bundle=await createBundle(doc,applied.resources.map((r:any)=>({path:r.path,mime:r.mime,bytes:Buffer.from(r.base64,'base64')})),applied.provenance);
  await page.goto('/');await page.locator('#open-bundle').setInputFiles({name:'slider.ui-bundle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
  await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
  const canvas=page.locator('#main-preview canvas');
  const snap=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
  const value=async()=>(await snap()).inspection.nodes.find(n=>n.id==='apply-slider')!.value;
  const events=async()=>(await snap()).events.filter(e=>e.id==='apply-slider'&&e.type==='change');
  const click=async(x:number)=>{await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.click(b.x+x*b.width/600,b.y+385*b.height/600);};
  await click(230);expect(await value()).toBe(spec.end);
  let count=(await events()).length;await click(230);expect((await events()).length).toBe(count);
  await canvas.focus();for(let i=0;i<5&&await canvas.getAttribute('data-focused-component')!=='apply-slider';i++)await page.keyboard.press('Tab');
  await expect(canvas).toHaveAttribute('data-focused-component','apply-slider');
  await page.keyboard.press('Home');expect(await value()).toBe(spec.min);
  const before=await canvas.screenshot();await page.keyboard.press('ArrowRight');expect(await value()).toBe(spec.next);
  const after=await canvas.screenshot({path:info.outputPath('next.png')});expect(after.equals(before)).toBe(false);
  await page.keyboard.press('End');expect(await value()).toBe(spec.end);count=(await events()).length;
  await page.keyboard.press('End');await page.keyboard.press('ArrowRight');expect((await events()).length).toBe(count);
  const recorded=await events();for(const e of recorded)expect(isStepAligned(e.value as number,spec.min,spec.step)).toBe(true);
  await writeFile(info.outputPath('input-events.json'),JSON.stringify({spec,events:recorded,human_visual_acceptance:false},null,2));
  const download=page.waitForEvent('download');await page.locator('#studio-export').click();const path=info.outputPath('saved.ui-bundle.json');await(await download).saveAs(path);
  const saved:any=await validateBundle(JSON.parse(await readFile(path,'utf8')));expect(saved.document.root.children[0].props.value).toBe(spec.end);
  await page.reload();await page.locator('#open-bundle').setInputFiles(path);await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);expect(await value()).toBe(spec.end);
});
