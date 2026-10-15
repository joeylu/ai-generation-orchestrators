import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {hash,readSafe,json} from '../src/skins/package.mjs';
import {previewAssemblyPart} from '../src/skins/authoring.mjs';
const current=JSON.parse(await readFile('work/asset-workbench/current.json')),dir=resolve(current.directory),files=new Map(),manifest=await readSafe(dir,'manifest.json');assert.equal(hash(manifest),current.sha256);
for(const f of JSON.parse(manifest).files){const b=await readSafe(dir,f.file);assert.equal(hash(b),f.sha256);files.set(f.file,b);}
const data=JSON.parse(files.get('data.json')),evidence=join(dir,'evidence');await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),errors=[],checks=[];
try{
  const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true,serviceWorkers:'block'});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url()),f=u.pathname==='/'?'index.html':u.pathname.slice(1);if(u.origin!=='http://127.0.0.1'||!files.has(f)){errors.push('Unexpected request '+f);return route.abort();}return route.fulfill({body:files.get(f),contentType:f.endsWith('.mjs')?'text/javascript':f.endsWith('.json')?'application/json':f.endsWith('.html')?'text/html':'application/octet-stream'});});
  await page.goto('http://127.0.0.1/');await page.waitForFunction(()=>window.workbenchReady);
  for(const skin of data.skins){
    await page.selectOption('#skin',skin.id);await page.waitForFunction(()=>window.workbenchReady);
    const sources=new Map(data.sources.filter(s=>s.key.startsWith(skin.id+'/')).map(s=>[s.key.slice(skin.id.length+1),{sha256:s.sha256,image:{width:s.width,height:s.height,pixels:files.get(s.rgba)}}]));
    for(const sheet of data.template.sheets){
      await page.selectOption('#sheet',sheet.id);
      for(const part of sheet.parts){
        await page.selectOption('#part',part.assetId);await page.waitForFunction(()=>window.workbenchReady);
        const expected=previewAssemblyPart(skin.config,data.template,sources,part.assetId).image;
        const actual=await page.evaluate(async()=>{const im=workbench.packed();return{width:im.width,height:im.height,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',im.pixels))].map(n=>n.toString(16).padStart(2,'0')).join('')};});
        assert.deepEqual(actual,{width:expected.width,height:expected.height,sha256:hash(expected.pixels)});checks.push(skin.id+'/'+part.assetId+'/exact-pixels');
      }
    }
  }
  await page.selectOption('#sheet','S01');await page.selectOption('#part','surface.panel');await page.waitForFunction(()=>window.workbenchReady);
  const original=await page.evaluate(()=>workbench.config());
  await page.fill('#x','-1');await page.click('#apply');assert.deepEqual(await page.evaluate(()=>workbench.config()),original);checks.push('invalid-crop-keeps-draft');
  await page.fill('#x',String(original.parts['surface.panel'].crop[0]+1));await page.click('#apply');await page.waitForFunction(()=>window.workbenchReady);
  assert.equal((await page.evaluate(()=>workbench.config())).parts['surface.panel'].crop[0],original.parts['surface.panel'].crop[0]+1);
  await page.click('#undo');assert.deepEqual(await page.evaluate(()=>workbench.config()),original);await page.click('#redo');checks.push('apply-undo-redo');
  const download=page.waitForEvent('download');await page.click('#export');const file=await download;await file.saveAs(join(evidence,'assembly.json'));const exported=JSON.parse(await readFile(join(evidence,'assembly.json')));assert.deepEqual(exported,await page.evaluate(()=>workbench.config()));
  await page.setInputFiles('#import',{name:'original.json',mimeType:'application/json',buffer:Buffer.from(json(original))});await page.waitForFunction(value=>JSON.stringify(workbench.config())===value,JSON.stringify(original));assert.deepEqual(await page.evaluate(()=>workbench.config()),original);
  await page.setInputFiles('#import',join(evidence,'assembly.json'));await page.waitForFunction(value=>JSON.stringify(workbench.config())===value,JSON.stringify(exported));assert.deepEqual(await page.evaluate(()=>workbench.config()),exported);checks.push('export-import-roundtrip');
  await page.click('#suggest');assert.deepEqual(await page.evaluate(()=>workbench.config()),exported);checks.push('suggestion-does-not-mutate');
  await page.locator('#source').scrollIntoViewIfNeeded();const box=await page.locator('#source').boundingBox(),im=data.sources.find(s=>s.key==='orbital-hangar/'+exported.parts['surface.panel'].file),r=exported.parts['surface.panel'].crop;
  const x=box.x+(r[0]+r[2]/2)*box.width/im.width,y=box.y+(r[1]+r[3]/2)*box.height/im.height;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+6,y+4,{steps:3});await page.mouse.up();assert.notDeepEqual((await page.evaluate(()=>workbench.config())).parts['surface.panel'].crop,r);checks.push('pointer-move');
  await page.waitForFunction(()=>window.workbenchReady);await page.screenshot({path:join(evidence,'workbench.png'),fullPage:true});
  const beforeReplace=await page.evaluate(()=>workbench.config()),sourceRecord=data.sources.find(s=>s.key==='orbital-hangar/'+beforeReplace.parts['surface.panel'].file);
  await page.setInputFiles('#replace',{name:'source.png',mimeType:'image/png',buffer:files.get(sourceRecord.png)});
  await page.waitForFunction(()=>workbench.config().parts['surface.panel'].file.startsWith('inputs/'));
  const replaced=await page.evaluate(()=>workbench.config());assert.equal(replaced.parts['surface.panel'].sha256,sourceRecord.sha256);assert.equal(Object.values(replaced.parts).filter(p=>p.file===replaced.parts['surface.panel'].file).length,4);checks.push('source-replacement-shared-binding');
  const sourceDownload=page.waitForEvent('download');await page.click('#download-source');await(await sourceDownload).saveAs(join(evidence,'source.png'));assert.equal(hash(await readFile(join(evidence,'source.png'))),sourceRecord.sha256);checks.push('download-original-source-bytes');
  await page.click('#undo');assert.deepEqual(await page.evaluate(()=>workbench.config()),beforeReplace);checks.push('undo-source-replacement');
  await page.selectOption('#sheet','S03');await page.selectOption('#part','scrollbar.thumb');const beforeCaps=await page.evaluate(()=>workbench.config());
  await page.fill('#capTop','9999');await page.click('#apply');assert.deepEqual(await page.evaluate(()=>workbench.config()),beforeCaps);checks.push('invalid-endcaps-keeps-draft');
  assert.deepEqual(errors,[]);await writeFile(join(evidence,'checks.json'),json({status:'passed',checks:checks.length,scenarios:checks,errors}));console.log(json({directory:dir,checks:checks.length,status:'passed'}));
}finally{await browser.close();}
