import { test, expect } from '@playwright/test';
import { nativeTabsHandoff } from '../helpers/native-tabs-fixture.ts';
import { importAndApplyComponentHandoff } from '../../src/component-handoff.ts';
import { compileMotionSystem } from '../../src/motion-system.ts';
test('raster Tabs style intermediate frames after real input',async({page},info)=>{
 const bundle=await importAndApplyComponentHandoff(await nativeTabsHandoff());
 await page.clock.install();await page.goto('/workbench.html');await page.waitForFunction(()=>Boolean(window.uiHarness));
 await page.clock.pauseAt(new Date(Date.now()+1000));
 const results:string[]=[];
 for(const style of ['original','playful','premium','corporate'] as const){
  await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
  if(style!=='original')await page.evaluate(s=>window.uiHarness.setMotionSystem(s),compileMotionSystem({id:'test-'+style,style,targets:['native-tabs']},bundle.document as any));
  await page.clock.runFor(1000);
  const canvas=page.locator('#canvas-host canvas'),box=await canvas.boundingBox();if(!box)throw Error('canvas');
  const before=await canvas.screenshot();
  await page.mouse.click(box.x+500*box.width/1000,box.y+60*box.height/240);
  await page.clock.runFor(50);
  expect(await page.evaluate(()=>window.uiHarness.inspect().nodes.find(n=>n.id==='native-tabs')?.value)).toBe('audio');
  const middle=await canvas.screenshot({path:info.outputPath(style+'-50ms.png')});
  await page.clock.runFor(400);const after=await canvas.screenshot({path:info.outputPath(style+'-settled.png')});
  if(style==='original')expect(middle.equals(after)).toBe(true);else{expect(middle.equals(before)).toBe(false);expect(middle.equals(after)).toBe(false);}
  results.push(middle.toString('base64'));
  await page.mouse.click(box.x+800*box.width/1000,box.y+60*box.height/240);
  await page.clock.runFor(30);
  await page.mouse.click(box.x+100*box.width/1000,box.y+60*box.height/240);
  await page.clock.runFor(400);
  expect(await page.evaluate(()=>window.uiHarness.inspect().nodes.find(n=>n.id==='native-tabs')?.value)).toBe('combat');
  await canvas.focus();for(let i=0;i<5 && await canvas.getAttribute('data-focused-component')!=='native-tabs';i++)await page.keyboard.press('Tab');
  await expect(canvas).toHaveAttribute('data-focused-component','native-tabs');await page.keyboard.press('End');await page.clock.runFor(400);
  expect(await page.evaluate(()=>window.uiHarness.inspect().nodes.find(n=>n.id==='native-tabs')?.value)).toBe('accessibility');
 }
 expect(new Set(results).size).toBe(4);
});
