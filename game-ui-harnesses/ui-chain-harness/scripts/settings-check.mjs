import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {hash,json,readSafe} from '../src/skins/package.mjs';
const dir=resolve(process.argv[2]),report=JSON.parse(await readSafe(dir,'report.json')),html=await readSafe(dir,'preview.html');
assert.equal(hash(html),report.files.find(f=>f.file==='preview.html').sha256);
const content=JSON.parse(await readSafe(dir,'content.json'));
const expected=JSON.parse(await readFile(process.argv[3]??new URL('../configs/settings-content.json',import.meta.url),'utf8'));
const semantics=c=>({title:c.title,closeLabel:c.closeLabel,fields:c.fields.map(f=>({type:f.type,label:f.label,enabled:f.enabled??true,
  ...(f.type==='select'?{options:f.options.map(o=>({label:o.label,enabled:o.enabled??true})),selectedLabel:f.options.find(o=>o.id===f.value)?.label}
    :{value:f.value,...(f.type==='slider'?{min:f.min,max:f.max,step:f.step}:{})})}))});
const semanticIssues=[];
try{assert.deepEqual(semantics(content),semantics(expected),'generated content must preserve independent expected semantics');}
catch{semanticIssues.push({code:'settings.expected-semantics',expected:semantics(expected),actual:semantics(content)});}
const toggle=content.fields.find(f=>f.type==='switch'&&f.enabled!==false),slider=content.fields.find(f=>f.type==='slider'&&f.enabled!==false),select=content.fields.find(f=>f.type==='select'&&f.enabled!==false);
assert(toggle&&slider&&select&&select.options.length>1,'this checker requires a switch, slider and multi-option select');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const checks=semanticIssues.length?[]:['independent expected semantics'],errors=[];
try{
  const p=await browser.newPage({viewport:{width:1280,height:1450},acceptDownloads:true});
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>r.request().url()==='http://127.0.0.1/settings-check'?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await p.goto('http://127.0.0.1/settings-check');await p.waitForFunction(()=>window.settingsPreview);
  const point=async(id,row)=>p.evaluate(({id,row,toggleId})=>{const h=settingsPreview,n=h.scene.runtime.handles.get(id),v=row===undefined?n.adapter.view:n.adapter.view.rows[row],b=v.getBounds();const c=h.app.canvas.getBoundingClientRect();const x=id===toggleId?b.x+18:b.x+b.width/2;return {x:c.left+x*c.width/h.app.screen.width,y:c.top+(b.y+Math.min(12,b.height/2))*c.height/h.app.screen.height};},{id,row,toggleId:toggle.id});
  const selectTab=async index=>{const q=await p.evaluate(index=>{const h=settingsPreview,b=h.scene.runtime.handles.get('settings-tabs').adapter.rows[index].getBounds(),c=h.app.canvas.getBoundingClientRect();return{x:c.left+(b.x+b.width/2)*c.width/h.app.screen.width,y:c.top+(b.y+b.height/2)*c.height/h.app.screen.height};},index);await p.mouse.click(q.x,q.y);};
  const tabFor=id=>content.tabs?.findIndex(t=>t.groupIds.some(g=>content.groups.find(group=>group.id===g).fieldIds.includes(id)));
  const reveal=async id=>p.evaluate(id=>{const h=settingsPreview,r=h.scene.runtime,scroll=[...r.handles.values()].find(handle=>handle.id.startsWith('settings-scroll')&&(()=>{for(let n=r.handles.get(id);n;n=n.parent)if(n===handle)return true;return false;})());if(!scroll||id==='close')return;const view=scroll.adapter.box,b=view.getBounds(),target=r.handles.get(id).root.getBounds(),offset=scroll.readState().initialOffsetY,max=Math.max(0,view.contentHeight-view.height);scroll.setState({initialOffsetY:Math.min(max,Math.max(0,offset+target.y-b.y-8))});r.flush();h.app.render();},id);
  const click=async(id,row)=>{if(row===undefined){const index=tabFor(id);if(index>=0)await selectTab(index);await reveal(id);}const q=await point(id,row);await p.mouse.click(q.x,q.y);};
  for(const orientation of ['landscape','portrait']){
    await p.locator(orientation==='landscape'?'#wide':'#tall').click();
    assert.equal(await p.evaluate(()=>settingsPreview.orientation),orientation);
    const textColors=await p.evaluate(()=>{const r=settingsPreview.scene.runtime;r.flush();return r.textColors?{rows:r.textColors.refresh(),inks:settingsPreview.skin.profile.textColors}:null;});
    if(textColors){
      assert(textColors.rows.some(row=>row.role==='skin.surface.panel'),'Panel labels must use panel ink');
      for(const row of textColors.rows)if(row.role!=='host-background')assert.equal(row.fill,textColors.inks[row.role]);
      checks.push(orientation+': frozen text role colors');
    }
    if(content.overflow==='scroll'){
      const q=await p.evaluate(()=>{const h=settingsPreview,r=h.scene.runtime,b=r.handles.get('settings-scroll'+(r.handles.has('settings-tabs')?'-0':'')).adapter.box.getBounds(),c=h.app.canvas.getBoundingClientRect();return {x:c.left+(b.x+b.width/2)*c.width/h.app.screen.width,y:c.top+(b.y+b.height/2)*c.height/h.app.screen.height,fixed:['heading','footer'].map(id=>{const b=r.handles.get(id).root.getBounds();return [b.x,b.y];})};});
      await p.mouse.move(q.x,q.y);await p.mouse.wheel(0,180);
      await p.waitForFunction(()=>settingsPreview.scene.runtime.handles.get('settings-scroll'+(settingsPreview.scene.runtime.handles.has('settings-tabs')?'-0':'')).readState().initialOffsetY>0);
      assert.deepEqual(await p.evaluate(()=>['heading','footer'].map(id=>{const b=settingsPreview.scene.runtime.handles.get(id).root.getBounds();return [b.x,b.y];})),q.fixed);checks.push(orientation+': wheel scroll with fixed title/footer');
    }
    const before=await p.evaluate(id=>settingsPreview.state[id].checked,toggle.id);await click(toggle.id);assert.equal(await p.evaluate(id=>settingsPreview.state[id].checked,toggle.id),!before);checks.push(orientation+': switch pointer');
    await reveal(slider.id);await p.evaluate(id=>{const r=settingsPreview.scene.runtime;r.focus(r.handles.get(id));},slider.id);await p.keyboard.press('End');assert.equal(await p.evaluate(id=>settingsPreview.state[id].value,slider.id),slider.max);checks.push(orientation+': slider keyboard');
    await click(select.id);await click(select.id,1);assert.equal(await p.evaluate(id=>settingsPreview.state[id].selectedId,select.id),select.options[1].id);checks.push(orientation+': select pointer');
    if(content.tabs){
      const saved=await p.evaluate(()=>settingsPreview.state);
      await selectTab(0);
      assert.equal(await p.evaluate(()=>settingsPreview.scene.runtime.handles.get('settings-tabs').readState().activeId),content.tabs[0].id);
      assert.deepEqual(await p.evaluate(()=>settingsPreview.state),saved);
      assert.equal(await p.evaluate(id=>settingsPreview.scene.runtime.handles.get(id).allowed(),select.id),false);
      const offset=await p.evaluate(()=>settingsPreview.scene.runtime.handles.get('settings-scroll-0').readState().initialOffsetY);
      await selectTab(1);await selectTab(0);
      assert.equal(await p.evaluate(()=>settingsPreview.scene.runtime.handles.get('settings-scroll-0').readState().initialOffsetY),offset);
      checks.push(orientation+': tab switch retains fields and scroll, hidden-page input suspended');
    }
    await p.locator('canvas').screenshot({path:join(dir,orientation+'.png')});
    await click('close');assert.equal(await p.evaluate(()=>settingsPreview.closed),true);
    await p.locator('#reopen').click();assert.equal(await p.evaluate(()=>settingsPreview.closed),false);assert.equal(await p.evaluate(id=>settingsPreview.state[id].value,slider.id),slider.max);checks.push(orientation+': close/reopen retains state');
    const download=p.waitForEvent('download');await p.locator('#export').click();const saved=JSON.parse(await readFile(await (await download).path(),'utf8'));
    assert.equal(saved.canvas,orientation);assert.equal(saved.bindings.sourceKind,'imported');assert.equal(saved.nodes.find(n=>n.id===slider.id).props.value,slider.value);checks.push(orientation+': export authored defaults, not play state');
  }
  assert.equal(await p.evaluate(id=>settingsPreview.state[id].selectedId,select.id),select.options[1].id);checks.push('orientation change retains selection');
  const initial=await p.evaluate(()=>settingsPreview.scene.runtime.handles.size);for(let i=0;i<4;i++)await p.locator('#reopen').click();assert.equal(await p.evaluate(()=>settingsPreview.scene.runtime.handles.size),initial);checks.push('reopen handle count stable');
  assert.deepEqual(errors,[]);
  const status=semanticIssues.length?'needs-review':'passed';
  await writeFile(join(dir,'checks.json'),json({previewSha256:hash(html),checks,errors,semanticIssues,status}),{flag:'wx'});
  console.log(json({directory:dir,checks:checks.length,semanticIssues:semanticIssues.length,status}));
  if(semanticIssues.length)process.exitCode=2;
}finally{await browser.close();}
