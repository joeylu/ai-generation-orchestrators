import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {verticalTabsReferenceHandoff,verticalTabCells} from '../helpers/vertical-tabs-fixture.ts';
import {importComponentHandoffWithReview} from '../../src/component-handoff.ts';

for(const modal of [false,true])test(`vertical Tabs Studio ${modal?'in Dialog':'standalone'}: real input, pixels and portable roundtrip`,async({page,context},info)=>{
  test.setTimeout(180000);
  const zip=await verticalTabsReferenceHandoff(modal), original=await importComponentHandoffWithReview(zip);
  await page.goto('/');await page.locator('#open-handoff').setInputFiles({name:'vertical.zip',mimeType:'application/zip',buffer:Buffer.from(zip)});
  await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
  const canvas=page.locator('#main-preview canvas');
  const snap=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);
  const value=async()=>(await snap()).inspection.nodes.find(n=>n.id==='vertical-tabs')?.value;
  const count=async()=>(await snap()).events.filter(e=>e.id==='vertical-tabs'&&e.type==='change').length;
  const click=async(x:number,y:number)=>{await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.click(b.x+x*b.width/600,b.y+y*b.height/400);};
  const samples=[];
  for(const [index,cell]of verticalTabCells.entries()){
    const before=await count();await click(25,20+cell.y+32);expect(await value()).toBe(cell.id);expect(await count()).toBe(before+(index===0?0:1));
    const nodes=(await snap()).inspection.nodes;
    for(const tab of verticalTabCells)expect(nodes.find(n=>n.id===tab.id+'-content')?.visible).toBe(tab.id===cell.id);
    const bytes=await canvas.screenshot({path:info.outputPath(cell.id+'.png')});
    const pixels=await page.evaluate(async({data,cells})=>{const im=new Image();im.src='data:image/png;base64,'+data;await im.decode();const c=document.createElement('canvas');c.width=600;c.height=400;const ctx=c.getContext('2d')!;ctx.drawImage(im,0,0,600,400);const rgb=(x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);return cells.map(q=>({base:rgb(192,25+q.y),icon:rgb(45,46+q.y)}));},{data:bytes.toString('base64'),cells:verticalTabCells});
    for(let i=0;i<3;i++){expect(pixels[i].base).toEqual(i===index?[20,150+i*30,210]:[30+i*30,50,70]);expect(pixels[i].icon).toEqual(i===index?[250,240,210]:[180,90,60]);}samples.push(pixels);
  }
  let before=await count();await click(25,90);expect(await count()).toBe(before);expect(await value()).toBe('accessibility');
  await canvas.focus();for(let i=0;i<12&&await canvas.getAttribute('data-focused-component')!=='vertical-tabs';i++)await page.keyboard.press('Tab');
  await expect(canvas).toHaveAttribute('data-focused-component','vertical-tabs');
  for(const [key,expected]of [['Home','combat'],['ArrowDown','audio'],['End','accessibility'],['ArrowUp','audio']] as const){before=await count();await page.keyboard.press(key);expect(await value()).toBe(expected);expect(await count()).toBe(before+1);}
  before=await count();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');expect(await count()).toBe(before);expect(await value()).toBe('audio');
  await page.keyboard.press('Home');before=await count();await page.keyboard.press('Home');expect(await count()).toBe(before);
  if(modal){await click(545,370);expect((await snap()).events.filter(e=>e.id==='outside-probe'&&e.type==='activate')).toHaveLength(0);}
  await writeFile(info.outputPath('real-input.json'),JSON.stringify({events:(await snap()).events,samples,human_visual_acceptance:false},null,2));
  const waitSave=page.waitForEvent('download');await page.locator('#studio-export').click();const saved=info.outputPath('saved.ui-bundle.json');await(await waitSave).saveAs(saved);
  await page.close();const reopened=await context.newPage();await reopened.goto('/');await reopened.locator('#open-bundle').setInputFiles(saved);await reopened.waitForFunction(()=>window.uiStudio?.snapshot().ready);
  const rc=reopened.locator('#main-preview canvas');await rc.focus();for(let i=0;i<12&&await rc.getAttribute('data-focused-component')!=='vertical-tabs';i++)await reopened.keyboard.press('Tab');await reopened.keyboard.press('End');
  expect(await reopened.evaluate(()=>window.uiStudio.snapshot().views[0].inspection.nodes.find(n=>n.id==='vertical-tabs')?.value)).toBe('accessibility');
  await rc.screenshot({path:info.outputPath('reopened.png')});
  const waitZip=reopened.waitForEvent('download');await reopened.getByRole('button',{name:'导出交付包',exact:true}).click();const out=info.outputPath('roundtrip.zip');await(await waitZip).saveAs(out);
  const roundtrip=await importComponentHandoffWithReview(await readFile(out));expect(roundtrip.referenceEvidence).toEqual(original.referenceEvidence);
  execFileSync(process.execPath,['scripts/cli.mjs','component-handoff',out,'--output',info.outputPath('official-reimport.json')]);
  const walk=(n:any):any[]=>[n,...(n.children??[]).flatMap(walk)];const n=walk((roundtrip.bundle.document as any).root).find(n=>n.id==='vertical-tabs');
  expect(n.props.appearance.layoutPolicy).toEqual({version:'1.0',orientation:'vertical'});expect(n.props.appearance.items.map((q:any)=>q.layout.y)).toEqual([0,76,152]);
});
