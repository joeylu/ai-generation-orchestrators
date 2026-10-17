import { parseArgs } from 'node:util';
import { readFile,writeFile,mkdir,rename,lstat,readdir } from 'node:fs/promises';
import { join,resolve,relative,isAbsolute,sep,parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { verifyNormalization } from '../src/skin-generation/normalize-build.mjs';
import { readSafe,hash,json,bindingsOf } from '../src/skins/package.mjs';
import { readContracts } from '../src/contracts/validate.mjs';
import { defaults } from '../src/contracts/build.mjs';
import { startHarness } from '../tests/runtime/harness.mjs';
import { validatePilotConfig } from '../src/skin-generation/pilot-config.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
async function noLinks(path){let current=parse(resolve(path)).root;for(const part of resolve(path).slice(current.length).split(/[\\/]/).filter(Boolean)){current=join(current,part);try{if((await lstat(current)).isSymbolicLink())throw Error('Links are forbidden.');}catch(e){if(e.code!=='ENOENT')throw e;}}}
const {values:v}=parseArgs({options:{package:{type:'string'},manifest:{type:'string'},out:{type:'string'},browser:{type:'string',default:'chrome'}}});
try{
  if(!v.package||!v.manifest)throw Error('Supply --package and --manifest.');
  const packageDir=resolve(v.package),output=resolve(v.out??join(root,'work/skin-pilot'));
  for(const p of [output,packageDir]){const r=relative(join(root,'work'),p);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use private work/ paths.');await noLinks(p);}
  const {manifest:m,replay}=await verifyNormalization({directory:packageDir,manifestSha256:v.manifest});
  if(replay!=='passed')throw Error('Rebuild the normalized candidate with current tools.');
  const inputs=await readContracts(defaults),bindings=bindingsOf(inputs);
  if(bindings.templateSha256!==m.bindings.templateSha256)throw Error('Pilot requires the same template geometry.');
  const configBytes=await readFile(join(root,'configs/skin-pilot.json')),config=validatePilotConfig(JSON.parse(configBytes)),base=JSON.parse(await readFile(join(root,'fixtures/neutral.skin.json'))),o=config.profileOverrides;
  const profile={...base,...o,palette:{...base.palette,...o.palette},geometry:{...base.geometry,...o.geometry}};
  const assets=[];
  for(const[role,rule]of Object.entries(config.roles)){
    const id=inputs.usage.bindings.find(b=>b.role===role)?.assetId,a=m.assets.find(a=>a.assetId===id);
    if(!a)throw Error('Required pilot role is missing: '+role);
    const bytes=await readSafe(packageDir,a.target.file),[width,height]=a.crop.slice(2);
    if(hash(bytes)!==a.target.sha256||bytes.length!==a.target.bytes)throw Error('Pilot source changed after verification.');
    const desired=rule.profileToken.split('.').reduce((x,k)=>x[k],profile)+(rule.profileOffset??0);
    if(!Number.isFinite(desired)||desired<=0)throw Error('Pilot texture density needs a positive profile size.');
    const density=(rule.crossAxis==='height'?height:width)/desired;
    const cap=(rule.slice==='capsule-x'?height:width)/2/density;
    const nineSlice=rule.slice==='capsule-x'?{left:cap,top:0,right:cap,bottom:0}:rule.slice==='capsule-y'?{left:0,top:cap,right:0,bottom:cap}:{left:0,top:0,right:0,bottom:0};
    assets.push({assetId:id,width,height,stretch:rule.slice==='uniform'?'uniform':rule.slice==='capsule-x'?'horizontal':'vertical',density,nineSlice,
      minSize:rule.slice==='capsule-x'?{width:cap*2+1,height:desired}:rule.slice==='capsule-y'?{width:desired,height:cap*2+1}:{width:1,height:1},sha256:hash(bytes),data:bytes.toString('base64')});
  }
  if(new Set(assets.map(a=>a.assetId)).size!==m.assets.length)throw Error('Pilot mapping does not cover the normalized assets exactly.');
  const packet={assets,outputScale:1},buildId=randomUUID(),candidate=join(output,'.staging',buildId);await noLinks(candidate);await mkdir(candidate,{recursive:true});
  const sourceFiles=['scripts/skin-pilot.mjs','src/skin-generation/pilot-config.mjs','configs/skin-pilot.json','fixtures/neutral.skin.json','fixtures/component-cases.json','fixtures/component-matrix.json','package.json','package-lock.json'];
  for(const dir of ['src/runtime','src/contracts','src/slicing','schemas','configs','tests/runtime'])for(const file of await readdir(join(root,dir)))if(/\.(mjs|json)$/.test(file)&&!sourceFiles.includes(dir+'/'+file))sourceFiles.push(dir+'/'+file);
  const source=[];for(const file of sourceFiles)source.push({file,sha256:hash(await readFile(join(root,file)))});
  const h=await startHarness({channel:v.browser,pilotSkin:packet,profile});
  const results=[];
  const check=async(id,fn)=>{try{await fn();results.push({id,status:'passed'});}catch(e){results.push({id,status:'failed',message:e.message});}};
  const make=async(type,overrides={})=>h.page.evaluate(({type,overrides})=>{harness.clear();window.current=harness.make(type,{size:{width:300,height:80},position:{x:40,y:40},...overrides});harness.runtime.flush();},{type,overrides});
  try{
    const galleryBundle=await build({entryPoints:[join(root,'tests/runtime/pilot-gallery.mjs')],bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
    await h.page.addScriptTag({type:'module',content:galleryBundle.outputFiles[0].text});
    await check('P01.partial-coverage',async()=>{
      assert.equal(await h.page.evaluate(()=>harness.skin.textures.size),9);
      assert.equal(await h.page.evaluate(()=>{try{harness.skin.texture('skin.button.primary.normal');return false;}catch(e){return e.code==='pilot.missing-role';}}),true);
    });
    await check('P02.slider-press-drag-release',async()=>{
      await make('Slider',{props:{min:0,max:100,step:1,value:20,showValue:false}});
      const p=await h.page.evaluate(()=>{const s=current.adapter.view;return{start:s.toGlobal({x:20,y:10}),end:s.toGlobal({x:s.bg.width,y:10})};});
      await h.page.mouse.move(p.start.x,p.start.y);await h.page.mouse.down();
      assert.equal(await h.page.evaluate(()=>current.adapter.view._slider1.children[0].texture===harness.skin.texture('skin.slider.thumb.pressed')),true);
      await h.page.mouse.move(p.end.x,p.end.y,{steps:8});await h.page.mouse.up();
      assert.equal(await h.page.evaluate(()=>current.readState().value),100);
      assert.equal(await h.page.evaluate(()=>current.adapter.view._slider1.children[0].texture===harness.skin.texture('skin.slider.thumb.normal')),true);
      assert.equal(await h.page.evaluate(()=>harness.events.filter(e=>e.event==='valueCommit').length),1);
    });
    await check('P03.slider-cancel-disable',async()=>{
      await make('Slider',{props:{value:40,showValue:false}});
      const p=await h.page.evaluate(()=>current.adapter.view.toGlobal({x:100,y:10}));await h.page.mouse.move(p.x,p.y);await h.page.mouse.down();
      await h.page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel')));await h.page.mouse.up();
      assert.equal(await h.page.evaluate(()=>current.readState().value),40);
      assert.equal(await h.page.evaluate(()=>current.adapter.view._slider1.children[0].texture===harness.skin.texture('skin.slider.thumb.normal')),true);
      await h.page.mouse.down();await h.page.evaluate(()=>current.setEnabled(false));await h.page.mouse.up();
      assert.equal(await h.page.evaluate(()=>current.adapter.view._slider1.children[0].texture===harness.skin.texture('skin.slider.thumb.normal')),true);
    });
    await check('P04.switch-click-states',async()=>{
      await make('Switch',{props:{checked:false,label:'音乐'}});
      const p=await h.page.evaluate(()=>current.adapter.view.toGlobal({x:30,y:20}));await h.page.mouse.click(p.x,p.y);
      assert.equal(await h.page.evaluate(()=>current.readState().checked),true);await h.page.mouse.click(p.x,p.y);assert.equal(await h.page.evaluate(()=>current.readState().checked),false);
      assert.equal(await h.page.evaluate(()=>harness.events.filter(e=>e.event==='valueChange').length),2);
    });
    await check('P05.progress-range-label',async()=>{
      await make('ProgressBar',{props:{min:10,max:30,value:20,showValue:true}});
      assert.equal(await h.page.evaluate(()=>current.adapter.bar.progress),50);await h.page.evaluate(()=>current.setState({value:30}));
      assert.equal(await h.page.evaluate(()=>current.adapter.bar.progress),100);
      assert.equal(await h.page.evaluate(()=>current.adapter.view.children[1].y),profile.trackHeight+profile.geometry.labelGap);
    });
    await check('P06.scroll-wheel-and-drag',async()=>{
      await make('ScrollView',{size:{width:300,height:160}});
      const p=await h.page.evaluate(()=>current.adapter.box.toGlobal({x:100,y:70}));await h.page.mouse.move(p.x,p.y);await h.page.mouse.wheel(0,140);await h.page.waitForTimeout(100);
      assert.ok(await h.page.evaluate(()=>current.adapter.box.scrollY<0));
      const bar=await h.page.evaluate(()=>{const a=current.adapter.bar,b=a._slider1.children[0].getBounds();return{x:b.x+b.width/2,y:b.y+b.height/2,end:a.toGlobal({x:8,y:156})};});
      await h.page.mouse.move(bar.x,bar.y);await h.page.mouse.down();await h.page.mouse.move(bar.end.x,bar.end.y,{steps:6});await h.page.mouse.up();
      assert.ok(await h.page.evaluate(()=>current.adapter.box.scrollY<=-(current.adapter.box.contentHeight-current.adapter.box.height)+1));
    });
    await check('P07.widths-and-disposal',async()=>{
      for(const type of ['Switch','Slider','ProgressBar','ScrollView']){
        await make(type,{size:{width:300,height:type==='ScrollView'?160:96}});
        for(const width of config.widths)await h.page.evaluate(width=>{current.resize(width,current.size.height);harness.runtime.flush();},width);
      }
      await h.page.evaluate(()=>harness.clear());assert.equal(await h.page.evaluate(()=>harness.runtime.handles.size),0);
    });
    await check('P08.minification-and-scrollbar-width',async()=>{
      await make('ScrollView',{size:{width:300,height:180}});
      const actual=await h.page.evaluate(()=>{
        const a=current.adapter,source=harness.skin.texture('skin.scrollbar.track').source;
        return{trackWidth:a.bar.bg.width,thumbWidth:a.bar._slider1.children[0].width,thumbHeight:a.bar._slider1.children[0].height,
          expectedHeight:Math.min(a.box.height,Math.max(harness.skin.profile.geometry.minThumbLength,a.box.height*a.box.height/a.box.contentHeight)),
          mipmaps:source.autoGenerateMipmaps,mipLevels:source.mipLevelCount,scaleMode:source.scaleMode};
      });
      assert.equal(actual.trackWidth,profile.geometry.scrollbarWidth);assert.equal(actual.thumbWidth,profile.geometry.scrollbarWidth);
      assert.equal(actual.thumbHeight,actual.expectedHeight);assert.equal(actual.mipmaps,true);assert.ok(actual.mipLevels>1);assert.equal(actual.scaleMode,'linear');
    });
    await writeFile(join(candidate,'checks.json'),json({results,errors:h.errors}),{flag:'wx'});
    if(results.some(r=>r.status!=='passed')||h.errors.length)throw Error('Pilot checks failed; see retained staging checks.json.');
    for(const[name,width,height]of[['landscape',1440,720],['portrait',720,1280]]){
      await h.page.setViewportSize({width,height});await h.page.evaluate(({width,height,widths})=>pilotGallery(width,height,widths),{width,height,widths:config.widths});
      await h.page.screenshot({path:join(candidate,name+'.png')});
    }
    const report={kind:'ui_partial_generated_skin_component_check',version:'0.1',buildId,manifestSha256:v.manifest,
      originalBindings:m.bindings,consumerBindings:bindings,consumerBindingReview:'pilot-same-role-identity-and-template',assets:assets.map(({data,...a})=>a),
      source,profile,results,errors:h.errors,browser:h.browser.version(),network:'blocked',scope:'9 generated candidate textures; 4 component types; fixture font/profile scaffold',visualAcceptance:'unreviewed',productionReady:false};
    await writeFile(join(candidate,'report.json'),json(report),{flag:'wx'});
    if(results.some(r=>r.status!=='passed')||h.errors.length)throw Error('Pilot checks failed; retained staging report.');
    const entryBundle=await build({entryPoints:[join(root,'tests/runtime/browser-entry.mjs'),join(root,'tests/runtime/pilot-gallery.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',outdir:'virtual',loader:{'.woff2':'dataurl','.woff':'dataurl'},logLevel:'silent'});
    const browserJs=entryBundle.outputFiles.find(f=>f.path.endsWith('browser-entry.js')).text,galleryJs=entryBundle.outputFiles.find(f=>f.path.endsWith('pilot-gallery.js')).text,css=entryBundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
    const data={...h.data,pilotSkin:packet,profile};
    await writeFile(join(candidate,'preview.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>S03 组件预览</title><style>${css}body{margin:0;background:#101b2b;color:#fff;font:14px system-ui}nav{padding:12px;display:flex;gap:12px;align-items:center}button{padding:8px 16px}canvas{display:block}p{margin:0}</style><nav><button id="wide">横版</button><button id="tall">竖版</button><span>可点击开关、拖动滑条和滚动条。S03 试验候选。</span></nav><script type="module">${browserJs}\n${galleryJs}\nconst data=${JSON.stringify(data).replaceAll('<','\\u003c')};await initializeComponents(data,1440,720);const draw=(w,h)=>pilotGallery(w,h,${JSON.stringify(config.widths)});document.getElementById('wide').onclick=()=>draw(1440,720);document.getElementById('tall').onclick=()=>draw(720,1280);draw(1440,720);</script></html>`,{flag:'wx'});
    await writeFile(join(candidate,'overview.md'),`# S03 真实部件组件试验\n\n9 个生成候选 PNG，4 类组件，${results.length} 项检查通过。字体与非视觉节点使用工程脚手架，非完整生产皮肤包。\n\n[交互预览](preview.html) · [报告](report.json)\n\n![横版](landscape.png)\n\n![竖版](portrait.png)\n`,{flag:'wx'});
    for(const f of source)if(hash(await readFile(join(root,f.file)))!==f.sha256)throw Error('Source changed during checks.');
    await verifyNormalization({directory:packageDir,manifestSha256:v.manifest});
    const files=[];for(const file of ['report.json','overview.md','preview.html','landscape.png','portrait.png']){const b=await readFile(join(candidate,file));files.push({file,sha256:hash(b),bytes:b.length});}
    const record=Buffer.from(json({kind:'ui_skin_pilot_build',version:'0.1',buildId,files,source,manifestSha256:v.manifest}));await writeFile(join(candidate,'build-record.json'),record,{flag:'wx'});
    await noLinks(join(output,'builds'));await mkdir(join(output,'builds'),{recursive:true});await rename(candidate,join(output,'builds',buildId));
    const pointer=join(output,buildId+'.tmp');await writeFile(pointer,json({kind:'ui_skin_pilot_current',buildId,recordSha256:hash(record)}),{flag:'wx'});await rename(pointer,join(output,'current.json'));
    console.log(json({status:'partial-pilot-checks-passed',buildId,assets:assets.length,components:4,checks:results.length,overview:`builds/${buildId}/overview.md`,productionReady:false}));
  }finally{await h.close();}
}catch(e){console.error(json({status:'failed',message:e.message}));process.exitCode=1;}
