import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './workspace-tools.mjs';
import {writeNewJson} from '../../src/io.mjs';

export async function checkAppleTypography(output,entries){
  const report={status:'FAIL',checks:[],fontEvidence:[],modelCalls:0,fontsEmbedded:false},errors=[],requests=[];
  const {chromium}=await loadWorkspaceTool('@playwright/test');let browser,page;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    page=await browser.newPage({viewport:{width:1260,height:1000}});
    const watch=page=>{page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});};watch(page);
    const session=await page.context().newCDPSession(page);await session.send('DOM.enable');await session.send('CSS.enable');
    const open=async key=>{
      await page.goto(pathToFileURL(resolve(output,'index.html')).href+`?panel=${key}`);
      await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
    };
    const platformFonts=async selector=>{
      const {root}=await session.send('DOM.getDocument'),{nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});
      return (await session.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
    };
    for(const [key,entry] of Object.entries(entries)){
      await open(key);
      // A completed paint is required; otherwise Chromium may report an empty font list.
      await page.screenshot({path:resolve(output,`${key}-type-comparison.png`),fullPage:true});
      const fonts={};for(const [id,weight,tag] of [['before','normal','span'],['before','bold','strong'],['after','normal','span'],['after','bold','strong']]){
        const selected=await platformFonts(`#specimen-${id} ${tag}`);assert(selected.length>0);
        fonts[`${id}-${weight}`]=selected.map(({familyName,postScriptName,isCustomFont,glyphCount})=>({familyName,postScriptName,isCustomFont,glyphCount}));
        if(id==='after'){
          assert(selected.some(font=>font.familyName===entry.face.platformFamily&&font.glyphCount>0),`${key}: candidate CJK font must actually render`);
          assert(selected.every(font=>[entry.face.platformFamily,'Segoe UI'].includes(font.familyName)),`${key}: only the selected CJK font and Segoe UI may render`);
        }
        else assert(selected.every(font=>['Segoe UI','Microsoft YaHei UI'].includes(font.familyName)));
      }
      const inspection=await page.evaluate(()=>window.applePanelReview.get('after').inspect());
      for(const node of inspection.nodes)for(const text of node.renderedTextBounds??[])assert.equal(text.fontFamily,entry.face.family);
      report.fontEvidence.push({key,fonts,canvasFamily:entry.face.family});
      report.checks.push(`${key}: normal/bold CJK font and Segoe UI verified in specimens; actual Pixi family matches`);
    }
    for(const width of [1260,390]){
      await page.setViewportSize({width,height:900});await open('audio-dark-noto');
      await page.locator('[data-font="deng"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert(page.url().endsWith('?panel=audio-dark-deng'));
      await page.locator('[data-purpose="profile"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert(page.url().endsWith('?panel=profile-dark-deng'));
      await page.locator('[data-mode="light"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert(page.url().endsWith('?panel=profile-light-deng'));
      await page.locator('[data-font="noto"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert(page.url().endsWith('?panel=profile-light-noto'));
      report.checks.push(`${width}px: font/type/mode navigation preserves other selections`);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('canvas').count(),2);
      report.checks.push(`${width}px: both canvases and specimens fit without horizontal page overflow`);
    }
    const retina=await browser.newPage({viewport:{width:1260,height:1000},deviceScaleFactor:2});watch(retina);
    await retina.goto(pathToFileURL(resolve(output,'index.html')).href+'?panel=audio-dark-noto');
    await retina.waitForFunction(()=>document.documentElement.dataset.ready==='true');
    report.highDpi=await retina.evaluate(()=>({devicePixelRatio,canvases:[...document.querySelectorAll('canvas')].map(canvas=>({bufferWidth:canvas.width,cssWidth:canvas.getBoundingClientRect().width,pixelRatio:canvas.width/canvas.getBoundingClientRect().width}))}));
    report.highDpi.status='EXISTING_1X_LIMITATION';
    await retina.close();
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);report.status='PASS';report.browserErrors=errors;report.externalRequests=requests.length;
  }catch(error){report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'typography-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await browser?.close();await writeNewJson(output,'typography-report.json',report);}
  if(report.status!=='PASS'){const error=new Error('APPLE_TYPOGRAPHY_GATE_FAILED');error.report=report;throw error;}return report;
}
