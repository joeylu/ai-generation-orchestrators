import {test,expect} from '@playwright/test';
import {createBundle} from '../../src/bundle.ts';
import {stateTemplateFixture,stateTemplateResources} from '../helpers/state-template-fixture.ts';
test('independent templates swap through actual input; separate selection marker moves and releases',async({page})=>{
 await page.route('**/api/**',r=>r.abort());await page.goto('/workbench.html');await page.waitForFunction(()=>Boolean(window.uiHarness));
 const bundle=await createBundle(stateTemplateFixture(),stateTemplateResources(),{kind:'programmatic-fixture',description:'Independent native state raster sizes and moving selection marker; deterministic SVG test assets.'});
 await page.locator('#bundle-file').setInputFiles({name:'state-template.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
 await expect.poll(()=>page.evaluate(()=>window.uiHarness.getDocument()?.id)).toBe('state-template-fixture');
 const canvas=page.locator('#canvas-host canvas'),box=await canvas.boundingBox();if(!box)throw Error('canvas');
 const samples=async()=>page.evaluate(async(base64)=>{const im=new Image();im.src='data:image/png;base64,'+base64;await im.decode();const c=document.createElement('canvas');c.width=240;c.height=180;const x=c.getContext('2d')!;x.drawImage(im,0,0);return [[175,80],[175,120],[100,20],[220,20]].map(([a,b])=>Array.from(x.getImageData(a,b,1,1).data));},(await canvas.screenshot()).toString('base64'));
 expect(await samples()).toEqual([[255,255,0,255],[255,255,255,255],[0,128,128,255],[255,255,255,255]]);
 await page.mouse.click(box.x+70,box.y+120);
 expect(await samples()).toEqual([[255,255,255,255],[255,255,0,255],[0,128,128,255],[255,255,255,255]]);
 await page.mouse.click(box.x+180,box.y+20);
 expect((await samples()).slice(2)).toEqual([[255,255,255,255],[0,128,128,255]]);
 const count=await page.evaluate(()=>window.uiHarness.inspect().resources);
 for(let i=0;i<12;i++){await page.mouse.click(box.x+70,box.y+(i%2?80:120));await page.mouse.click(box.x+(i%2?60:180),box.y+20);}
 expect(await page.evaluate(()=>window.uiHarness.inspect().resources)).toBe(count);
 const result=await page.evaluate(()=>{window.uiHarness.destroyNode('list');return window.uiHarness.inspect();});expect(result.resources).toBe(2);
});
test('actual image decode rejects an independently declared wrong raster canvas',async({page})=>{
 await page.goto('/workbench.html');await page.waitForFunction(()=>Boolean(window.uiHarness));const doc=stateTemplateFixture();(doc.root as any).children[0].props.appearance.selectedIndicator.canvas.width=9;
 const bundle=await createBundle(doc,stateTemplateResources(),{kind:'programmatic-fixture',description:'Decoded marker size mismatch regression.'});
 await page.locator('#bundle-file').setInputFiles({name:'bad-state-template.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
 await expect(page.locator('#error')).toContainText('LIST_INDICATOR_CANVAS_MISMATCH');await expect(page.locator('#export-bundle')).toBeDisabled();
});
test('paint regions retain native List primitives inside renderer masks',async({page})=>{
 await page.goto('/workbench.html');await page.waitForFunction(()=>Boolean(window.uiHarness));const bundle=await createBundle(stateTemplateFixture(),stateTemplateResources(),{kind:'programmatic-fixture',description:'Mask geometry must not erase native List paint measurements.'});
 await page.locator('#bundle-file').setInputFiles({name:'masked-template.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await expect.poll(()=>page.evaluate(()=>window.uiHarness.getDocument()?.id)).toBe('state-template-fixture');
 const regions=await page.evaluate(()=>window.uiHarness.inspect().paintRegions!.filter(r=>r.componentId==='list'));
 expect(regions.some(r=>r.bounds.x===170&&r.bounds.y===75&&r.bounds.width===10&&r.bounds.height===10)).toBe(true);
 expect(regions.filter(r=>r.bounds.width===200&&r.bounds.height===40).length).toBeGreaterThanOrEqual(3);
});
