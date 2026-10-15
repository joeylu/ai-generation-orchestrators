import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {readSafe,hash,json} from '../src/skins/package.mjs';

// Read verified, self-contained preview artifacts. Never run a model or mutate a package.
const root=fileURLToPath(new URL('../',import.meta.url));
const local=value=>{const path=resolve(value),r=relative(join(root,'work'),path);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use work/ paths');return path;};
if(process.argv.length!==3)throw Error('Use panel-first-screen-check.mjs <preview-directory>');
const input=local(process.argv[2]),reportBytes=await readSafe(input,'report.json'),report=JSON.parse(reportBytes);
if(!['settings-panel-preview','action-panel-preview'].includes(report.kind))throw Error('Unsupported preview kind');
for(const f of report.files)if(hash(await readSafe(input,f.file))!==f.sha256)throw Error('Preview digest differs');
const html=await readFile(join(input,'preview.html'));
const output=join(root,'work/panels/first-screen-checks',randomUUID());await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[],errors=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:1500}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url()==='http://127.0.0.1/first-screen-check'?r.fulfill({contentType:'text/html',body:html}):r.abort());
  const modes=report.kind==='settings-panel-preview'?['settings']:['confirmation','form'];
  for(const mode of modes)for(const orientation of ['landscape','portrait']){
    // Fresh load per sample: no focus navigation or component interaction before observation.
    await page.goto('http://127.0.0.1/first-screen-check',{timeout:60000});
    await page.waitForFunction(()=>window.settingsPreview||window.actionPreview);
    if(mode!=='settings')await page.locator('#'+mode).click();
    await page.locator(orientation==='landscape'?'#wide':'#tall').click();
    const observed=await page.evaluate(async()=>{
      await new Promise(requestAnimationFrame);
      const h=window.settingsPreview??window.actionPreview,{document:doc,runtime}=h.scene;
      const bounds=b=>({x:b.x,y:b.y,width:b.width,height:b.height});
      const canvas={x:0,y:0,width:h.app.screen.width,height:h.app.screen.height};
      const surface=runtime.handles.get(doc.nodes.some(n=>n.id==='settings')?'settings':'surface');
      // Use the authored panel frame, not getBounds() which could expand with overflowing children.
      const origin=surface.root.toGlobal({x:0,y:0});
      const frame={x:origin.x,y:origin.y,width:surface.size.width,height:surface.size.height};
      const inside=(b,c)=>b.width>0&&b.height>0&&b.x>=c.x-.5&&b.y>=c.y-.5&&b.x+b.width<=c.x+c.width+.5&&b.y+b.height<=c.y+c.height+.5;
      const buttons=doc.nodes.filter(n=>n.recipeRef.startsWith('button@')).map(n=>{
        const handle=runtime.handles.get(n.id),b=bounds(handle.adapter.view.getBounds());
        let visible=true;
        for(let parent=handle.adapter.view;parent;parent=parent.parent)if(!parent.visible||!parent.renderable||parent.alpha<=0)visible=false;
        return{id:n.id,label:n.props.label,bounds:b,visible,withinCanvas:inside(b,canvas),withinPanel:inside(b,frame)};
      });
      return{canvas,frame,buttons};
    });
    const screenshot=mode+'-'+orientation+'.png';await page.screenshot({path:join(output,screenshot),fullPage:true});
    results.push({mode,orientation,...observed,screenshot,status:observed.buttons.length&&observed.buttons.every(b=>b.visible&&b.withinCanvas&&b.withinPanel)?'passed':'failed'});
  }
}finally{await browser.close();}
const status=errors.length===0&&results.every(r=>r.status==='passed')?'passed':'failed';
await writeFile(join(output,'report.json'),json({kind:'ui_panel_first_screen_check',status,input:relative(root,input).replaceAll('\\','/'),inputReportSha256:hash(reportBytes),scope:'initial button bounds in canvas and panel; no text-fit or semantic acceptance claim',modelCalls:0,errors,results}),{flag:'wx'});
console.log(json({directory:relative(root,output).replaceAll('\\','/'),status,samples:results.length}));
if(status!=='passed')process.exitCode=1;
