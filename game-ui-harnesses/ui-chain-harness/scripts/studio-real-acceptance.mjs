// Manual acceptance only. Never imported by tests; requires explicit compute authorization.
import {chromium} from 'playwright';
import {writeFile,access} from 'node:fs/promises';
if(process.argv[2]!=='--real-confirmed')throw Error('EXPLICIT_COMPUTE_CONFIRMATION_REQUIRED');
const record='work/studio/real-acceptance.json';
try{await access(record);throw Error('ACCEPTANCE_ALREADY_STARTED_NO_RESUBMIT');}catch(e){if(e.code!=='ENOENT')throw e;}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:4210');
 await page.locator('#new-project').click();
 await page.locator('#draft-name').fill('晨光烘焙 · 完整流程验收');
 await page.locator('#draft-description').fill('奶油色底、浅焦糖描边、珊瑚色强调，少量草绿色状态色。保留柔和烘焙质感。仅通用 UI 皮肤，无食品图案、功能图标或文字。严格遵循几何模板的独立部件和留白，滑条轨道保持空白可拉伸，滑块独立。');
 await page.locator('#reference-file').setInputFiles('work/skins/sunrise-bakery-codex/reference.png');
 await page.locator('#reference-preview').waitFor({state:'visible'});
 const response=page.waitForResponse(r=>r.url().endsWith('/projects/plan'));
 await page.locator('#prepare-plan').click();const plan=await(await response).json();
 if(!plan.generationId)throw Error('PLAN_NOT_PREPARED');
 await writeFile(record,JSON.stringify({plan,authorization:'User explicitly authorized real full-workflow acceptance in this conversation.',status:'prepared'},null,2),{flag:'wx'});
 await page.getByRole('button',{name:'检查生成环境',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='确认生成整批四张'&&!b.disabled),null,{timeout:120000});
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:'确认生成整批四张',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#plan-result').textContent.includes('已开始整批生成'));
 await page.screenshot({path:'work/studio/real-start.png',fullPage:true});
 await writeFile(record,JSON.stringify({plan,status:'submitted-once',startedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({status:'submitted-once',plan}));
}finally{await browser.close();}
