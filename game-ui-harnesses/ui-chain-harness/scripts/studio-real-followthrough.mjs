// Manual acceptance of the existing, single submitted batch. No image submission here.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const action=process.argv[2];
if(!['process','panel-prepare','panel-run-confirmed','inspect'].includes(action))throw Error('ACTION_REQUIRED');
const record=JSON.parse(await readFile('work/studio/real-acceptance.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 const readyFrame=async()=>{const frame=page.frames().find(f=>f.url().includes('/artifacts/'));if(!frame)throw Error('PREVIEW_FRAME_MISSING');await frame.waitForFunction(()=>window.settingsPreview||window.actionPreview||window.consumerData);await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push(m.text().slice(0,300));});
 await page.goto('http://127.0.0.1:4210');
 await page.locator('#view-plans').click();
 const card=page.locator('#history-list > details').filter({hasText:record.plan.batchSha256});
 await card.locator('summary').click();await card.getByRole('button',{name:'打开项目工作区'}).click();
 await page.waitForFunction(()=>document.querySelector('#pipeline-title').textContent.includes('完整流程验收'));
 if(action==='process'){
  await page.waitForFunction(()=>!document.querySelector('#process-skin').disabled);
  page.once('dialog',d=>d.accept());await page.locator('#process-skin').click();
  console.log('Deterministic processing started. No model call.');
 }else if(action==='panel-prepare'){
  await page.locator('#panel-request').fill('使用当前选定皮肤，创建游戏设置面板，标题“游戏设置”，关闭按钮“关闭”。按顺序包含：背景音乐开关默认开启；游戏音效开关默认开启；音乐音量滑块0到100，步长1，默认65；音效音量滑块0到100，步长1，默认80；显示语言下拉选项“简体中文”和“English”，默认简体中文。所有控件启用，不加图标，不加分组标题。横版16:9和竖版9:16均适用。');
  const response=page.waitForResponse(r=>r.url().endsWith('/pipeline/panel-prepare'));
  await page.locator('#panel-prepare').click();const result=await(await response).json();
  if(!result.sha256)throw Error(JSON.stringify(result));
  await writeFile('work/studio/real-panel-plan.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }else if(action==='panel-run-confirmed'){
  const planned=JSON.parse(await readFile('work/studio/real-panel-plan.json','utf8'));
  // The UI only exposes unconsumed plans. A duplicate invocation cannot resubmit.
  const button=page.getByRole('button',{name:'确认生成面板',exact:true});
  await button.waitFor();if(await button.count()!==1)throw Error('AMBIGUOUS_PANEL');
  page.once('dialog',d=>d.message().includes(planned.sha256)?d.accept():d.dismiss());
  const response=page.waitForResponse(r=>r.url().endsWith('/pipeline/panel-start'));
  await button.click();console.log(JSON.stringify(await(await response).json()));
 }else{
  await page.waitForTimeout(1000);await page.screenshot({path:'work/studio/real-workspace.png',fullPage:true});
  if(!await page.getByRole('button',{name:'预览 16 类组件'}).count())throw Error('COMPONENTS_NOT_READY');
  if(await page.getByRole('button',{name:'预览 16 类组件'}).count()){
   const download=page.waitForEvent('download');await page.locator('#pipeline-skin a').filter({hasText:'完整交付包'}).click();await(await download).saveAs('work/studio/real-components.zip');
   await page.getByRole('button',{name:'预览 16 类组件'}).click();await page.frameLocator('iframe').locator('canvas').first().waitFor();await readyFrame();await page.screenshot({path:'work/studio/real-components.png',fullPage:true});
   await page.locator('#view-pipeline').click();
  }
  const panel=page.getByRole('button',{name:'预览面板',exact:true});
  if(!await panel.count())throw Error('PANEL_NOT_READY');
  if(await panel.count()){
   const download=page.waitForEvent('download');await page.locator('#pipeline-panels a').filter({hasText:'完整交付包'}).first().click();await(await download).saveAs('work/studio/real-panel.zip');
   await panel.first().click();await page.frameLocator('iframe').locator('canvas').first().waitFor();await readyFrame();await page.screenshot({path:'work/studio/real-panel.png',fullPage:true});
  }
  await page.setViewportSize({width:375,height:812});await page.locator('#view-pipeline').click();await page.waitForTimeout(800);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('MOBILE_OVERFLOW');
  await page.screenshot({path:'work/studio/real-workspace-mobile.png',fullPage:true});
  await writeFile('work/studio/real-browser-check.json',JSON.stringify({status:errors.length?'failed':'passed',errors,checks:['history workspace restoration','component ZIP download','panel ZIP download','component preview','panel preview','mobile width']},null,2));
  console.log(JSON.stringify({errors}));
 }
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
