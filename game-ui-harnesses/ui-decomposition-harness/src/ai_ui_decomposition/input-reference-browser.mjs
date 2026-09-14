// Official reference replay and real input verification; accepts consumed Bundle JSON.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [rootArg,zipArg,outArg,id]=process.argv.slice(2);
const root=resolve(rootArg),zip=resolve(zipArg),out=resolve(outArg);
await mkdir(out,{recursive:false});
const {chromium}=await import(pathToFileURL(resolve(root,'node_modules/playwright/index.mjs')));
const dist=resolve(root,'dist'),hash=b=>createHash('sha256').update(b).digest('hex');
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');const path=resolve(dist,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 if(!path.startsWith(dist+sep))throw Error('path');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({channel:process.env.UI_HARNESS_BROWSER||'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:2200,height:1600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/reference-acceptance.html`);
 const bundle=JSON.parse(await readFile(zip,'utf8'));
 await page.waitForFunction(()=>!!window.referenceAcceptance);await page.evaluate(b=>window.referenceAcceptance.load(b),bundle);
 const snap=()=>page.evaluate(()=>window.referenceAcceptance.inspect());
 const input=s=>s.inspection.nodes.find(n=>n.id===id);
 const canvas=page.locator('#runtime canvas');await canvas.scrollIntoViewIfNeeded();
 const results=[];
 for(let i=0;i<2;i++){await page.evaluate(()=>window.referenceAcceptance.replay());const s=await snap(),n=input(s);assert.equal(n.value,'');assert.deepEqual(n.inputEditing,{focused:true,selectionStart:0,selectionEnd:0,selectionDirection:'none',caretVisible:true});results.push({input:'reference-replay-'+i,node:n,unknown:s.unknownFields});}
 await canvas.screenshot({path:resolve(out,'reference-caret-on.png')});
 await page.keyboard.type('QA');let s=await snap();assert.equal(input(s).value,'QA');assert.equal(input(s).inputEditing.selectionStart,2);assert.ok(s.events.some(e=>e.id===id&&['input','change'].includes(e.type)));results.push({input:'real-keyboard-QA',node:input(s)});
 await page.keyboard.press('Shift+Home');s=await snap();assert.equal(input(s).inputEditing.selectionStart,0);assert.equal(input(s).inputEditing.selectionEnd,2);assert.equal(input(s).inputEditing.caretVisible,false);results.push({input:'real-keyboard-selection',node:input(s)});await canvas.screenshot({path:resolve(out,'selection.png')});
 await page.keyboard.type('Z');s=await snap();assert.equal(input(s).value,'Z');results.push({input:'real-selection-replacement',node:input(s)});
 await page.evaluate(()=>window.referenceAcceptance.replay());s=await snap();assert.equal(input(s).value,'');assert.equal(input(s).inputEditing.caretVisible,true);
 // Real mouse focus elsewhere hides TITLE caret; compare its interior pixels.
 const name=s.inspection.nodes.find(n=>n.id==='name-input');const r=await canvas.boundingBox();await page.mouse.click(r.x+(name.bounds.x+30)*r.width/bundle.document.canvas.width,r.y+(name.bounds.y+30)*r.height/bundle.document.canvas.height);
 s=await snap();assert.equal(input(s).inputEditing.focused,false);assert.equal(input(s).inputEditing.caretVisible,false);await canvas.screenshot({path:resolve(out,'reference-caret-blurred.png')});results.push({input:'real-mouse-blur-title',node:input(s)});
 await page.evaluate(()=>window.referenceAcceptance.replay());const final=await snap();assert.equal(input(final).inputEditing.caretVisible,true);assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'report.json'),JSON.stringify({kind:'input_reference_replay_v11',status:'passed',bundleSha256:hash(await readFile(zip)),results,final,errors,human_visual_acceptance:false},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
