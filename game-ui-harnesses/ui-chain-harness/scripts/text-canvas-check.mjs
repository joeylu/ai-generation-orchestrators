import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {studioSnapshot} from '../src/studio/catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=relative(root,resolve(process.argv[2])).replaceAll('\\','/');
const snapshot=await studioSnapshot(root,{version:'0.1',name:'文字检查',artifacts:[{id:'text-verification',name:'文字检查',type:'components',directory}]});
const out=join(root,'work/text-readability/canvas-evidence');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],blocked=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:'block'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url()),file=u.pathname.slice(1),bytes=snapshot.files.get(file);
  if(u.origin!=='http://127.0.0.1'||!bytes){blocked.push(u.pathname);return r.abort();}
  await r.fulfill({body:bytes,contentType:file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html'});
 });
 await page.goto('http://127.0.0.1/component-canvas.html#text-verification');await page.waitForFunction(()=>window.studioCanvas);
 const result=await page.evaluate(()=>({formal:!!studioCanvas.h.runtime.textColors,count:studioCanvas.items.length,status:document.querySelector('#status').textContent,report:studioCanvas.readability,rows:studioCanvas.contrast.refresh()}));
 assert(result.formal);assert.equal(result.count,16);assert.match(result.status,/正式字色/);assert(result.report.checks.length>0);
 assert.equal(await page.getByRole('link',{name:'查看文字检查'}).count(),1);
 assert(result.rows.some(r=>r.role==='skin.field.normal'));assert(result.rows.some(r=>r.role==='skin.button.primary.normal'));
 if(result.report.status==='needs-review')assert.match(result.status,/需复核/);
 await page.screenshot({path:join(out,'canvas.png')});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 await writeFile(join(out,'checks.json'),JSON.stringify({status:'passed',formal:result.formal,components:16,textReadability:result.report.status,rows:result.rows,modelCalls:0,errors,blocked},null,2));
 console.log(JSON.stringify({status:'passed',directory:out,textReadability:result.report.status}));
}finally{await browser.close();}
