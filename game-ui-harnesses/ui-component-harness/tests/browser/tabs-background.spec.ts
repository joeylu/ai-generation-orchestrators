import {test,expect} from '@playwright/test';
import {createBundle} from '../../src/bundle.ts';
import {applyAppearanceBinding} from '../../src/appearance-apply.ts';
import {appearanceDocumentSha256} from '../../src/appearance-binding.ts';
import {nativeTabsFixture} from '../helpers/native-tabs-fixture.ts';

test('Tabs plate visibility preserves parent pixels and real selection',async({page},info)=>{
 await page.goto('/workbench.html');await page.waitForFunction(()=>Boolean(window.uiHarness));
 const canvas=page.locator('#canvas-host canvas');
 for(const mode of [undefined,true,false]){
  const f=await nativeTabsFixture(),doc=structuredClone(f.document) as any;
  doc.root.props.style={...doc.root.props.style,backgroundColor:'#153B57'};doc.root.children[0].props.style={...doc.root.children[0].props.style,backgroundColor:'#F1E9CF'};
  if(mode!==undefined)doc.root.children[0].props.drawBackground=mode;
  const target=await createBundle(doc,[],{kind:'programmatic-fixture',description:'Background pixel regression'});
  const bundle=await applyAppearanceBinding(target,f.imported,{...f.binding,documentSha256:await appearanceDocumentSha256(doc)});
  await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
  const shot=await canvas.screenshot({path:info.outputPath(`background-${mode}.png`)});
  const pixel=await page.evaluate(async data=>{const i=new Image();i.src='data:image/png;base64,'+data;await i.decode();const c=document.createElement('canvas');c.width=1000;c.height=240;const ctx=c.getContext('2d')!;ctx.drawImage(i,0,0,1000,240);return Array.from(ctx.getImageData(392,40,1,1).data).slice(0,3);},shot.toString('base64'));
  expect(pixel).toEqual(mode===false?[21,59,87]:[241,233,207]);
  const box=await canvas.boundingBox();expect(box).not.toBeNull();
  await page.mouse.click(box!.x+450*box!.width/1000,box!.y+60*box!.height/240);
  expect(await page.evaluate(()=>window.uiHarness.inspect().nodes.find(n=>n.id==='native-tabs')?.value)).toBe('audio');
  expect(await page.locator('#events li').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('audio')]));
 }
});
