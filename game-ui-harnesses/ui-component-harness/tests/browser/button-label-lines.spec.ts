import {test,expect} from '@playwright/test';
import {buttonLinesFixture} from '../helpers/button-label-lines-fixture.ts';
import {applyAppearanceBinding} from '../../src/appearance-apply.ts';
import {buttonLineChecks} from '../../../ui-decomposition-harness/src/ai_ui_decomposition/button-label-lines-browser.mjs';
test('two Button lines keep alignment during real input and disabled buttons emit no clicks',async({page},info)=>{
 const f=await buttonLinesFixture(),bundle=structuredClone(await applyAppearanceBinding(f.target,f.imported,f.binding)),node=(bundle.document as any).root.children[0];
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/workbench.html');await page.waitForFunction(()=>!!window.uiHarness);
 const canvas=page.locator('#canvas-host canvas');
 for(const enabled of [true,false]){
  node.props.enabled=enabled;await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);await page.evaluate(()=>document.querySelector('#events').replaceChildren());await canvas.scrollIntoViewIfNeeded();
  const inspect=()=>page.evaluate(()=>window.uiHarness.inspect().nodes.find(n=>n.id==='apply-button'));
  const initial=(await inspect())!;const b=(await canvas.boundingBox())!;
  const at={x:b.x+60*b.width/500,y:b.y+30*b.height/400};
  const check=async(name:string)=>{
   await page.waitForTimeout(160);
   const actual=await inspect(),p=await page.evaluate(()=>window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id==='apply-button').presentation);
   const scale=['entryScale','pressScale','hoverScale','emphasisScale'].reduce((v,k)=>v*(p[k]??1),1);
   expect(buttonLineChecks(node,actual,initial.bounds,scale).every(c=>c.pass)).toBe(true);
   await canvas.screenshot({path:info.outputPath(`${enabled}-${name}.png`)});
  };
  await check('default');await page.mouse.move(at.x,at.y);await check('hover');
  await page.mouse.down();await check('pressed');await page.mouse.up();
  await canvas.focus();await page.keyboard.press('Tab');await page.keyboard.press('Space');await check('keyboard');
  const events=(await page.locator('#events li').allTextContents()).map(t=>JSON.parse(t)).filter(e=>e.id==='apply-button'&&e.type==='activate');
  if(enabled){expect(events.some(e=>e.source==='mouse')).toBe(true);expect(events.some(e=>e.source==='keyboard')).toBe(true);}else expect(events).toEqual([]);
 }
 expect(errors).toEqual([]);
});
