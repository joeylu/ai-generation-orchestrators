import {Application,Texture,ImageSource,Sprite} from 'pixi.js';
import {SlicedBackground} from '../tools/panel-slicer/src/sliced-background.mjs';
import {suggestSlices} from '../tools/panel-slicer/src/suggestion.mjs';
import {validateAssemblyDraft,previewAssemblyPart} from '../src/skins/authoring.mjs';
const $=id=>document.getElementById(id),sides=['left','top','right','bottom'];
for(const group of ['slices','insets'])for(const side of sides){const label=document.createElement('label');label.textContent={left:'左',top:'上',right:'右',bottom:'下'}[side];const input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.id=group+'-'+side;label.append(input);$(group).append(label);}
const data=await(await fetch('data.json')).json(),drafts=new Map(),sources=new Map();
for(const item of data.sources){const raw=new Uint8Array(await(await fetch(item.rgba)).arrayBuffer());sources.set(item.key,{sha256:item.sha256,image:{width:item.width,height:item.height,pixels:raw},png:item.png});}
for(const skin of data.skins){drafts.set(skin.id,{config:structuredClone(skin.config),history:[],future:[]});$('skin').add(new Option(skin.label,skin.id));}
const state=()=>drafts.get($('skin').value),partDef=()=>data.template.sheets.flatMap(s=>s.parts).find(p=>p.assetId===$('part').value),part=()=>state().config.parts[$('part').value];
const activeSources=()=>new Map([...sources].filter(([key])=>key.startsWith($('skin').value+'/')).map(([key,s])=>[key.slice($('skin').value.length+1),s]));
const source=()=>activeSources().get(part().file),rect=()=>part().crop??[0,0,source().image.width,source().image.height];
const message=text=>{$('status').textContent=text;};
const app=new Application();await app.init({width:600,height:250,backgroundAlpha:0,preference:'webgl',antialias:true,preserveDrawingBuffer:true});$('render').append(app.canvas);
let texture,view,suggestion,renderTicket=0,drag,liveBitmap;
const canvasOf=image=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.pixels),image.width,image.height),0,0);return c;};
function drawSource(){
  const image=source().image,c=$('source');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(canvasOf(image),0,0);
  for(const [id,p]of Object.entries(state().config.parts))if(p.file===part().file){const r=id===$('part').value&&drag?drag.current:p.crop??[0,0,image.width,image.height];ctx.strokeStyle=id===$('part').value?'#ffcc55':'#64baff';ctx.lineWidth=Math.max(2,image.width/400);ctx.strokeRect(...r);ctx.font=`${Math.max(14,image.width/65)}px system-ui`;ctx.fillStyle=ctx.strokeStyle;ctx.fillText(id,r[0]+3,Math.max(20,r[1]-5));if(id===$('part').value){const q=image.width/65;ctx.fillRect(r[0]+r[2]-q,r[1]+r[3]-q,q,q);}}
  $('file').textContent=part().file+' · '+image.width+' × '+image.height;
}
function fields(){
  const d=part();['x','y','w','h'].forEach((id,i)=>$(id).value=rect()[i]);$('density').value=d.metadata.density??1;
  for(const side of sides){$('slices-'+side).value=d.metadata.nineSlice[side];$('slices-'+side).disabled=partDef().stretch==='uniform';$('insets-'+side).value=d.metadata.contentInsets[side];}
  $('minW').value=d.metadata.minSize.width;$('minH').value=d.metadata.minSize.height;
  $('vertical').checked=!!d.fit;$('vertical').disabled=partDef().stretch!=='vertical';$('capTop').value=d.fit?.caps[0]??1;$('capBottom').value=d.fit?.caps[1]??1;
  $('undo').disabled=!state().history.length;$('redo').disabled=!state().future.length;
}
function packed(){return previewAssemblyPart(state().config,data.template,activeSources(),$('part').value).image;}
async function render(){
  window.workbenchReady=false;
  const ticket=++renderTicket,image=packed(),d=part(),p=partDef(),density=(d.metadata.density??1)*data.template.coordinates.outputScale;
  const c=$('packed');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(canvasOf(image),0,0);
  const b=d.metadata.nineSlice;ctx.strokeStyle='#ff6b7a';ctx.lineWidth=1;ctx.beginPath();for(const x of [b.left*density,image.width-b.right*density]){ctx.moveTo(x,0);ctx.lineTo(x,image.height);}for(const y of [b.top*density,image.height-b.bottom*density]){ctx.moveTo(0,y);ctx.lineTo(image.width,y);}ctx.stroke();
  const pad=d.metadata.contentInsets;ctx.strokeStyle='#6cecac';ctx.strokeRect(pad.left*density,pad.top*density,image.width-(pad.left+pad.right)*density,image.height-(pad.top+pad.bottom)*density);
  const width=Number($('targetW').value),height=Number($('targetH').value);if(![width,height].every(n=>Number.isInteger(n)&&n>=1&&n<=2048)||width<d.metadata.minSize.width||height<d.metadata.minSize.height)throw Error('目标尺寸须在最小尺寸到2048以内');
  // Canvas is only an upload surface; fitting bytes use the same raster code as CLI.
  const bitmap=await createImageBitmap(canvasOf(image),{premultiplyAlpha:'premultiply',colorSpaceConversion:'none'});
  if(ticket!==renderTicket){bitmap.close();return;}
  view?.destroy({children:true});texture?.destroy(true);liveBitmap?.close();liveBitmap=bitmap;
  texture=new Texture({source:new ImageSource({resource:bitmap,resolution:density,alphaMode:'premultiplied-alpha',scaleMode:'linear',autoGenerateMipmaps:p.stretch!=='vertical'})});
  view=p.stretch==='uniform'?new Sprite({texture}):new SlicedBackground({texture,borders:b,width,height});
  if(p.stretch==='uniform'){const scale=Math.min(width/view.width,height/view.height);view.scale.set(scale);}
  app.renderer.resize(width+24,height+24);view.position.set(12,12);app.stage.addChild(view);app.render();window.workbenchReady=true;
}
function refresh(){fields();drawSource();suggestion=null;$('suggestion').textContent='';$('apply-suggestion').disabled=true;return render();}
function validate(config){return validateAssemblyDraft(config,data.template,data.templateSha256,activeSources());}
async function commit(next){validate(next);state().history.push(structuredClone(state().config));state().future=[];state().config=next;message('草稿已更新；导出后由统一后处理再次校验。');try{await refresh();}catch(e){message('配置已更新，但预览目标不适用：'+e.message);}}
function resetTarget(){const m=part().metadata;$('targetW').value=Math.max(m.minSize.width,partDef().stretch==='vertical'?10:partDef().stretch==='uniform'?64:280);$('targetH').value=Math.max(m.minSize.height,partDef().stretch==='vertical'?120:partDef().stretch==='uniform'?64:80);}
function selectSheet(){const prev=$('part').value;$('part').replaceChildren();for(const p of data.template.sheets.find(s=>s.id===$('sheet').value).parts)$('part').add(new Option(p.assetId,p.assetId));if([...$('part').options].some(o=>o.value===prev))$('part').value=prev;resetTarget();return refresh();}
function selectSkin(){$('sheet').replaceChildren();for(const s of data.template.sheets)$('sheet').add(new Option(s.id,s.id));message('已载入皮肤草稿；共 '+Object.keys(state().config.parts).length+' 件。');return selectSheet();}
const safe=fn=>async event=>{try{await fn(event);}catch(e){message(e.message);window.workbenchError=e.message;}};
$('skin').onchange=safe(selectSkin);$('sheet').onchange=safe(selectSheet);$('part').onchange=safe(()=>{resetTarget();return refresh();});
$('apply').onclick=safe(()=>{const next=structuredClone(state().config),d=next.parts[$('part').value];d.crop=['x','y','w','h'].map(id=>Number($(id).value));d.metadata.density=Number($('density').value);for(const side of sides){d.metadata.nineSlice[side]=Number($('slices-'+side).value);d.metadata.contentInsets[side]=Number($('insets-'+side).value);}d.metadata.minSize={width:Number($('minW').value),height:Number($('minH').value)};if($('vertical').checked)d.fit={method:'vertical-slice',caps:[Number($('capTop').value),Number($('capBottom').value)]};else delete d.fit;return commit(next);});
$('render-button').onclick=safe(render);
$('suggest').onclick=safe(()=>{suggestion=partDef().stretch==='uniform'?{status:'unsupported',reason:'等比部件不使用九宫格'}:suggestSlices(packed(),(part().metadata.density??1)*data.template.coordinates.outputScale);$('suggestion').textContent=JSON.stringify(suggestion,null,2);$('apply-suggestion').disabled=suggestion.status!=='supported';});
$('apply-suggestion').onclick=safe(()=>{if(suggestion?.status!=='supported')return;const next=structuredClone(state().config);next.parts[$('part').value].metadata.nineSlice=Object.fromEntries(sides.map(k=>[k,Math.ceil(suggestion.nineSlice[k])]));return commit(next);});
for(const [id,from,to]of [['undo','history','future'],['redo','future','history']])$(id).onclick=safe(()=>{const s=state();if(!s[from].length)return;s[to].push(s.config);s.config=s[from].pop();return refresh();});
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=safe(()=>{validate(state().config);download(JSON.stringify(state().config,null,2)+'\n','assembly.json','application/json');message('已导出。请保留源图相对路径，在工作目录运行 skins:postprocess 检查；当前页不能写入仓库。');});
$('import').onchange=safe(async()=>{const file=$('import').files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('配置文件过大');const next=JSON.parse(await file.text());if(next.id!==state().config.id)throw Error('请选择对应皮肤后再导入');await commit(next);$('import').value='';});
$('replace').onchange=safe(async()=>{const f=$('replace').files[0];if(!f)return;if(f.size>32*1024*1024)throw Error('源图过大');const bytes=new Uint8Array(await f.arrayBuffer());if(bytes[0]!==137||String.fromCharCode(...bytes.slice(1,4))!=='PNG')throw Error('仅支持PNG');const bitmap=await createImageBitmap(f);if(bitmap.width>4096||bitmap.height>4096){bitmap.close();throw Error('源图尺寸上限4096');}const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=new Uint8Array(ctx.getImageData(0,0,c.width,c.height).data),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join(''),file='inputs/'+sha256.slice(0,16)+'.png',key=$('skin').value+'/'+file;
  const next=structuredClone(state().config),old=part().file;for(const p of Object.values(next.parts))if(p.file===old){p.file=file;p.sha256=sha256;}sources.set(key,{sha256,image:{width:c.width,height:c.height,pixels},bytes});try{await commit(next);}catch(e){sources.delete(key);throw e;}message('源图已绑定至 '+file+'。请下载源图并放到导出配置旁的inputs目录；浏览器解码预览仅供核对，正式字节由CLI校验。');$('replace').value='';});
$('download-source').onclick=safe(async()=>{const s=source(),bytes=s.bytes??await(await fetch(s.png)).arrayBuffer();download(bytes,part().file.split('/').at(-1),'image/png');});
function pointer(event){const b=$('source').getBoundingClientRect();return[(event.clientX-b.left)*$('source').width/b.width,(event.clientY-b.top)*$('source').height/b.height];}
$('source').onpointerdown=event=>{const [x,y]=pointer(event),r=rect();if(x<r[0]||y<r[1]||x>r[0]+r[2]||y>r[1]+r[3]){const hit=Object.entries(state().config.parts).find(([,p])=>p.file===part().file&&p.crop&&x>=p.crop[0]&&y>=p.crop[1]&&x<=p.crop[0]+p.crop[2]&&y<=p.crop[1]+p.crop[3]);if(hit&&[...$('part').options].some(o=>o.value===hit[0])){$('part').value=hit[0];safe(()=>{resetTarget();return refresh();})();}return;}drag={start:[x,y],rect:[...r],current:[...r],resize:x>r[0]+r[2]-source().image.width/40&&y>r[1]+r[3]-source().image.width/40};$('source').setPointerCapture(event.pointerId);};
$('source').onpointermove=event=>{if(!drag)return;const [x,y]=pointer(event),dx=Math.round(x-drag.start[0]),dy=Math.round(y-drag.start[1]),r=drag.rect,im=source().image;drag.current=drag.resize?[r[0],r[1],Math.max(1,Math.min(im.width-r[0],r[2]+dx)),Math.max(1,Math.min(im.height-r[1],r[3]+dy))]:[Math.max(0,Math.min(im.width-r[2],r[0]+dx)),Math.max(0,Math.min(im.height-r[3],r[1]+dy)),r[2],r[3]];drawSource();};
$('source').onpointerup=safe(()=>{if(!drag)return;const next=structuredClone(state().config);next.parts[$('part').value].crop=drag.current;drag=null;return commit(next);});$('source').onpointercancel=()=>{drag=null;drawSource();};
window.workbench={config:()=>structuredClone(state().config),packed,validate:()=>validate(state().config)};
await selectSkin();
