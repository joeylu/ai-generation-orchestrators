import {test,expect} from '@playwright/test';
import {selectMenuHighlightsFixture,fixtureMenuHighlights} from '../helpers/select-menu-highlights-fixture.ts';
import {selectOptionIconsFixture} from '../helpers/select-option-icons-fixture.ts';
import {componentHandoffEntries} from '../../src/decomposition-import.ts';
import {readFile,writeFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const blend=(base:number[],color:number[],alpha:number)=>base.map((c,i)=>Math.round(c*(1-alpha)+color[i]*alpha));
for(const legacy of [false,true])test(legacy?'legacy Select retains green selected/hover stacking':'explicit Select highlight pixels, input and portable Studio roundtrip',async({page},info)=>{
 const f=await(legacy?selectOptionIconsFixture():selectMenuHighlightsFixture());const captures:any[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('/');await page.locator('#open-handoff').setInputFiles({name:'highlights.zip',mimeType:'application/zip',buffer:Buffer.from(f.zip)});await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 const canvas=page.locator('#main-preview canvas');await canvas.scrollIntoViewIfNeeded();
 const snapshot=()=>page.evaluate(()=>window.uiStudio.snapshot().views[0]);const node=async()=>(await snapshot()).inspection.nodes.find(n=>n.id==='region')!;
 const events=async()=>(await snapshot()).events.filter(e=>e.id==='region'&&e.type==='change');
 const at=async(x:number,y:number)=>{await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();if(!b)throw Error('canvas');return[b.x+x*b.width/500,b.y+y*b.height/400]as const;};
 const move=async(x:number,y:number)=>page.mouse.move(...await at(x,y));const click=async(x:number,y:number)=>page.mouse.click(...await at(x,y));
 const capture=async(name:string)=>{
  const bytes=await canvas.screenshot({path:info.outputPath(name+'.png')});
  const pixels=await page.evaluate(async data=>{const image=new Image();image.src=data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);const point=(x:number,y:number)=>[...ctx.getImageData(Math.floor(x*c.width/500),Math.floor(y*c.height/400),1,1).data].slice(0,3);let textPixels=0;const d=ctx.getImageData(0,0,c.width,c.height).data;for(let y=Math.ceil(130*c.height/400);y<260*c.height/400;y++)for(let x=Math.ceil(124*c.width/500);x<280*c.width/500;x++){const i=(y*c.width+x)*4;if(d[i]===24&&d[i+1]===37&&d[i+2]===63)textPixels++;}return{rows:[148,196,244].map(y=>point(320,y)),icons:[148,196,244].map(y=>point(92,y)),outside:point(70,120),inset:point(74,148),corner:point(76,128),textPixels};},'data:image/png;base64,'+bytes.toString('base64'));
  captures.push({name,pixels,node:await node(),events:await events()});return pixels;
 };
 const base=[252,250,236],selected=blend(base,legacy?[107,143,58]:[32,64,192],legacy?.14:.5),hover=blend(base,legacy?[107,143,58]:[192,64,32],legacy?.12:.25);
 const close=(a:number[],b:number[])=>a.forEach((n,i)=>expect(Math.abs(n-b[i])).toBeLessThanOrEqual(2));
 const colors=(p:any)=>{[[220,40,60],[15,150,80],[40,100,225]].forEach((c,i)=>close(p.icons[i],c));expect(p.textPixels).toBeGreaterThan(20);close(p.outside,base);};
 await click(160,84);await move(480,350);let p=await capture('selected');close(p.rows[0],selected);close(p.rows[1],base);colors(p);if(!legacy){close(p.inset,base);close(p.corner,base);}
 await move(320,196);p=await capture('hover-other');close(p.rows[0],selected);close(p.rows[1],hover);colors(p);
 await move(320,148);p=await capture('selected-and-hovered');close(p.rows[0],legacy?blend(selected,[107,143,58],.12):selected);colors(p);
 await move(480,350);p=await capture('pointer-out');close(p.rows[0],selected);close(p.rows[1],base);
 if(legacy){expect(await events()).toHaveLength(0);await writeFile(info.outputPath('evidence.json'),JSON.stringify({legacy:true,human_visual_acceptance:false,captures},null,2));return;}
 await click(92,196);expect((await node()).value).toBe('green');expect(await events()).toHaveLength(1);expect((await events())[0].source).toBe('mouse');expect((await node()).popupItems).toEqual([]);p=await capture('closed');close(p.rows[2],[243,245,250]);
 await page.keyboard.press('Tab');await page.keyboard.press('Enter');expect((await node()).popupOpen).toBe(true);await move(320,196);p=await capture('green-reopened');close(p.rows[1],selected);close(p.rows[0],base);
 await page.keyboard.press('ArrowDown');expect((await node()).value).toBe('blue');expect(await events()).toHaveLength(2);expect((await events())[1].source).toBe('keyboard');p=await capture('keyboard-blue-hover-green');close(p.rows[2],selected);close(p.rows[1],hover);colors(p);
 await page.keyboard.press('ArrowDown');expect(await events()).toHaveLength(2);await page.keyboard.press('Escape');expect((await node()).popupItems).toEqual([]);
 await click(160,84);await move(480,350);p=await capture('blue-reopened-clean');close(p.rows[2],selected);close(p.rows[1],base);await page.keyboard.press('Escape');
 const save=page.waitForEvent('download');await page.locator('#studio-export').click();await(await save).saveAs(info.outputPath('saved.json'));await page.reload();await page.locator('#open-bundle').setInputFiles(info.outputPath('saved.json'));await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);
 expect((await snapshot()).document.root.children[0].props.appearance.menuHighlights).toEqual(fixtureMenuHighlights);await click(160,84);await move(480,350);p=await capture('saved-reopened');close(p.rows[2],selected);await page.keyboard.press('Escape');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出交付包',exact:true}).click();await(await download).saveAs(info.outputPath('roundtrip.zip'));
 const entries=await componentHandoffEntries(new Uint8Array(await readFile(info.outputPath('roundtrip.zip'))));for(const[name,bytes]of f.entries)if(name!=='handoff.json')expect(entries.get(name),name).toEqual(bytes);
 const cli=fileURLToPath(new URL('../../scripts/cli.mjs',import.meta.url));const run=spawnSync(process.execPath,[cli,'component-handoff',info.outputPath('roundtrip.zip'),'--output',info.outputPath('cli-reimport.json')],{encoding:'utf8'});expect(run.status,run.stderr).toBe(0);
 await page.reload();await page.locator('#open-bundle').setInputFiles(info.outputPath('cli-reimport.json'));await page.waitForFunction(()=>window.uiStudio?.snapshot().ready);await click(160,84);await move(480,350);p=await capture('cli-reimport');close(p.rows[2],selected);colors(p);await click(92,148);expect((await node()).value).toBe('red');expect(await events()).toHaveLength(1);
 expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('studio-page.png'),fullPage:true});await writeFile(info.outputPath('evidence.json'),JSON.stringify({human_visual_acceptance:false,errors,captures,persistence:'UI save/reopen/export and official CLI reimport passed'},null,2));
});
