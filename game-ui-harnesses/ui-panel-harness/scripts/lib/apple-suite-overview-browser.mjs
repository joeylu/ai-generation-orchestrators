import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './workspace-tools.mjs';
import {writeNewJson} from '../../src/io.mjs';

export async function checkAppleSuiteOverview(output){
  const report={status:'FAIL',checks:[],modelCalls:0},errors=[],requests=[];
  const {chromium}=await loadWorkspaceTool('@playwright/test');let browser,page;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    for(const width of [1260,390]){
      await page.setViewportSize({width,height:900});
      await page.goto(pathToFileURL(resolve(output,'overview.html')).href);
      await page.waitForFunction(()=>[...document.images].length===12&&[...document.images].every(image=>image.complete&&image.naturalWidth>0));
      assert.equal(await page.locator('.collection:not([hidden]) .sample').count(),6);
      assert.equal(await page.locator('[data-mode="light"]').getAttribute('aria-pressed'),'true');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:resolve(output,`overview-light-${width}.png`),fullPage:true});
      report.checks.push(`${width}px: six light samples visible, twelve actual screenshots loaded and page contained`);
      await page.locator('[data-mode="dark"]').click();
      assert.equal(await page.locator('.collection:not([hidden])').getAttribute('data-collection'),'dark');
      assert.equal(await page.locator('.collection:not([hidden]) .sample').count(),6);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:resolve(output,`overview-dark-${width}.png`),fullPage:true});
      report.checks.push(`${width}px: dark switch and correct collection`);
      await page.locator('.collection:not([hidden]) a').first().click();
      await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
      assert(page.url().endsWith('?panel=menu-dark'));assert.equal(await page.locator('canvas').count(),2);
      await page.locator('[data-purpose="audio"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
      assert(page.url().endsWith('?panel=audio-dark'));
      await page.locator('[data-mode="light"]').click();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
      assert(page.url().endsWith('?panel=audio-light'));
      await page.getByRole('link',{name:'查看整套总览 ↗'}).click();assert(page.url().includes('overview.html'));
      report.checks.push(`${width}px: thumbnail opens playable pair, type/mode navigation preserves selection and overview return works`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);report.status='PASS';report.browserErrors=errors;report.externalRequests=requests.length;
  }catch(error){report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'overview-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await browser?.close();await writeNewJson(output,'overview-report.json',report);}
  if(report.status!=='PASS'){const error=new Error('APPLE_SUITE_OVERVIEW_GATE_FAILED');error.report=report;throw error;}return report;
}
