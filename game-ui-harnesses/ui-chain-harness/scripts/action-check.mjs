import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {hash,json,readSafe} from '../src/skins/package.mjs';
const dir=resolve(process.argv[2]),report=JSON.parse(await readSafe(dir,'report.json')),html=await readSafe(dir,'preview.html');
assert.equal(hash(html),report.files.find(f=>f.file==='preview.html').sha256);
const presetsBytes=await readSafe(dir,'presets.json');
assert.equal(hash(presetsBytes),report.files.find(f=>f.file==='presets.json').sha256);
const presets=JSON.parse(presetsBytes),examples=JSON.parse(await readFile(new URL('../examples/action-presets.json',import.meta.url)));
const semanticIssues=[];
for(const example of examples){
  const actual=presets.find(p=>p.content.presetId===example.presetId)?.content;
  const fields=[],actions=[];
  for(const [index,r]of example.rows.entries()){
    const id='row'+index;
    if(r.kind==='button')actions.push({id,label:r.label,enabled:r.enabled,variant:r.recipeKey.includes('.secondary@')?'secondary':'primary',action:r.action,targets:(r.action==='submit'?r.submitRows:r.resetRows).map(i=>'row'+i)});
    else if(r.kind==='text')fields.push({id,type:'text',label:r.label,text:r.text,wrap:r.wrap});
    else if(r.kind==='checkbox')fields.push({id,type:'check-box',label:r.label,enabled:r.enabled,checked:r.initial});
    else fields.push({id,type:'input',label:r.label,enabled:r.enabled,value:r.initial,placeholder:r.placeholder,inputType:r.inputType,readOnly:r.readOnly,maxLength:r.maxLength,required:r.required,minLength:r.minLength});
  }
  const expected={title:example.title,sectionTitle:example.sectionTitle,fields,actions};
  const observed=actual&&{title:actual.title,sectionTitle:actual.sectionTitle,fields:actual.fields,actions:actual.actions};
  try{assert.deepEqual(observed,expected);}catch{semanticIssues.push({preset:example.presetId,expected,actual:observed??null});}
}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const checks=[],errors=[];
try{
  const p=await browser.newPage({viewport:{width:1280,height:1500},acceptDownloads:true});
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>r.request().url()==='http://127.0.0.1/action-check'?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await p.goto('http://127.0.0.1/action-check');
  await p.waitForFunction(()=>window.actionPreview);
  const click=async(id)=>{const q=await p.evaluate(id=>{const h=actionPreview,b=h.scene.runtime.handles.get(id).adapter.view.getBounds(),c=h.app.canvas.getBoundingClientRect();return {x:c.left+(b.x+(id==='row2'&&h.state.row2?18:b.width/2))*c.width/h.app.screen.width,y:c.top+(b.y+b.height/2)*c.height/h.app.screen.height};},id);await p.mouse.click(q.x,q.y);};
  for(const orientation of ['landscape','portrait']){
    await p.locator(orientation==='landscape'?'#wide':'#tall').click();
    await p.locator('#confirmation').click();
    await p.locator('canvas').screenshot({path:join(dir,'confirmation-'+orientation+'.png')});
    for(const id of ['row1','row2']){await click(id);assert.equal(await p.evaluate(()=>actionPreview.closed),true);assert.equal(await p.evaluate(()=>actionPreview.scene.runtime.handles.get('surface').readState().open),false);await p.locator('#reopen').click();}
    checks.push(orientation+': both confirmation actions close and reopen');
    await p.locator('#form').click();
    await click('row3');await click('row4');assert.equal(await p.evaluate(()=>actionPreview.lastResult.errors.length),1);
    checks.push(orientation+': empty submit rejected');
    await click('row1');await p.locator('input').fill('小林');await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(()=>actionPreview.state.row1.value),'小林');
    await click('row2');assert.equal(await p.evaluate(()=>actionPreview.state.row2.checked),false);
    await click('row4');assert.deepEqual(await p.evaluate(()=>actionPreview.lastResult.event.values),{row1:{value:'小林'},row2:{checked:false}});
    checks.push(orientation+': native input, checkbox and submit');
    await p.locator('canvas').screenshot({path:join(dir,'form-'+orientation+'.png')});
    const download=p.waitForEvent('download');await p.locator('#export').click();const saved=JSON.parse(await readFile(await(await download).path(),'utf8'));
    assert.equal(saved.document.canvas,orientation);assert.equal(saved.document.nodes.find(n=>n.id==='row1').props.value,'');assert.equal(saved.behavior.fields.find(f=>f.id==='row1').required,true);
    checks.push(orientation+': export defaults and validation behavior');
    await click('row3');assert.deepEqual(await p.evaluate(()=>actionPreview.state),{row1:{value:''},row2:{checked:true}});
    checks.push(orientation+': reset exact targets');
  }
  assert.deepEqual(errors,[]);
  const status=semanticIssues.length?'needs-review':'passed';
  await writeFile(join(dir,'checks.json'),json({previewSha256:hash(html),checks,errors,semanticIssues,status}),{flag:'wx'});
  console.log(json({directory:dir,checks:checks.length,semanticIssues:semanticIssues.length,status}));
  if(semanticIssues.length)process.exitCode=2;
}finally{await browser.close();}
