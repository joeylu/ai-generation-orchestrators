import { Application,Container,Sprite,Texture } from 'pixi.js';
import { importLayerPackage,type LayerPackage } from './layer-package.ts';
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const stage=element('stage'),status=element('status'),error=element('error'),empty=element('empty');
const mode=element<HTMLSelectElement>('mode'),zoom=element<HTMLInputElement>('zoom');
const controls=['mode','fit','zoom','download-layer','download-package'];
let app:Application|undefined,scene:Container|undefined,art:Container|undefined,reference:Sprite|undefined;
let pack:LayerPackage|undefined,archive:File|undefined,selected:string|undefined,solo:string|undefined;
let generation=0;const sprites=new Map<string,Sprite>(),visible=new Map<string,boolean>();
function clear(){app?.destroy(true,{children:true,texture:true,textureSource:true});app=undefined;scene=undefined;art=undefined;reference=undefined;pack=undefined;archive=undefined;selected=undefined;solo=undefined;sprites.clear();visible.clear();element('layers').replaceChildren();element('summary').textContent='尚未打开拆分包';element('issues').hidden=true;empty.hidden=false;for(const id of controls)(element(id) as HTMLButtonElement).disabled=true;}
function download(data:Blob,name:string){const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function texture(data:Uint8Array){const url=URL.createObjectURL(new Blob([new Uint8Array(data).buffer],{type:'image/png'}));try{const image=new Image();image.src=url;await image.decode();return Texture.from(image);}finally{URL.revokeObjectURL(url);}}
function update(){if(!art||!reference)return;art.visible=mode.value!=='reference';reference.visible=mode.value!=='composite';reference.alpha=mode.value==='overlay'?.5:1;for(const [id,sprite] of sprites)sprite.visible=Boolean(visible.get(id))&&(!solo||id===solo);app?.render();}
function scale(value:number){if(!scene||!pack||!app)return;scene.scale.set(value);scene.position.set((app.screen.width-pack.composition.canvas.width*value)/2,(app.screen.height-pack.composition.canvas.height*value)/2);zoom.value=String(Math.round(value*100));element('zoom-value').textContent=Math.round(value*100)+'%';app.render();}
function fit(){if(!pack||!app)return;scale(Math.min((app.screen.width-32)/pack.composition.canvas.width,(app.screen.height-32)/pack.composition.canvas.height));}
const observer=new ResizeObserver(()=>{if(app){app.renderer.resize(stage.clientWidth,stage.clientHeight);fit();}});observer.observe(stage);
function rows(){if(!pack)return;const list=element('layers');list.replaceChildren();for(const layer of [...pack.composition.layers].reverse()) {const row=document.createElement('div');row.className='layer';const check=document.createElement('input');check.type='checkbox';check.checked=visible.get(layer.id)??true;check.setAttribute('aria-label','显示 '+layer.id);check.onchange=()=>{visible.set(layer.id,check.checked);update();};const label=document.createElement('label');label.textContent=layer.name;label.title=layer.id;const button=document.createElement('button');button.textContent='单层';button.setAttribute('aria-label','单层 '+layer.id);button.setAttribute('aria-pressed',String(solo===layer.id));button.onclick=()=>{selected=layer.id;solo=solo===layer.id?undefined:layer.id;mode.value='composite';element<HTMLButtonElement>('download-layer').disabled=false;rows();update();};row.append(check,label,button);list.append(row);}}
async function open(file:File){const token=++generation;clear();error.hidden=true;status.textContent='正在校验文件与图层…';let pending:Application|undefined;
  try{if(file.size>256*1024*1024)throw new Error('包超过 256 MB 限制');const loaded=await importLayerPackage(new Uint8Array(await file.arrayBuffer()));if(token!==generation)return;
    pending=new Application();await pending.init({width:stage.clientWidth,height:stage.clientHeight,backgroundAlpha:0,preference:'webgl',antialias:false,resolution:1});
    const root=new Container(),layers=new Container();root.addChild(layers);pending.stage.addChild(root);
    const textures:Texture[]=[];
    for(const layer of loaded.composition.layers){const t=await texture(loaded.files.get(layer.path)!);textures.push(t);if(t.width!==layer.width||t.height!==layer.height)throw new Error('Decoded layer dimensions differ');const s=new Sprite(t);s.position.set(layer.x,layer.y);layers.addChild(s);}
    const ref=new Sprite(await texture(loaded.files.get('reference.png')!));root.addChild(ref);
    if(token!==generation){pending.destroy(true,{children:true,texture:true,textureSource:true});return;}
    app=pending;pending=undefined;scene=root;art=layers;reference=ref;pack=loaded;archive=file;
    loaded.composition.layers.forEach((l,i)=>{sprites.set(l.id,layers.children[i] as Sprite);visible.set(l.id,true);});
    stage.append(app.canvas);empty.hidden=true;for(const id of controls)(element(id) as HTMLButtonElement).disabled=false;element<HTMLButtonElement>('download-layer').disabled=true;
    mode.value='composite';rows();fit();update();const c=loaded.composition;
    element('summary').textContent=`${c.layers.length} 个图层 · ${c.canvas.width} × ${c.canvas.height}\n${c.textPolicy==='remove-business-text'?'去字美术图层':'保留栅格文字'}`;
    const issues=element('issues');issues.replaceChildren();const title=document.createElement('p');title.textContent='待视觉验收 · 技术校验不代表还原度通过';issues.append(title);for(const text of loaded.issues){const p=document.createElement('p');p.textContent='• '+text;issues.append(p);}issues.hidden=false;
    status.textContent=`已校验并回拼 ${c.layers.length} 个图层 · 拖动画布平移，滚轮缩放`;
    let drag:{x:number;y:number;px:number;py:number}|undefined;const canvas=app.canvas;
    canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,px:root.x,py:root.y};});
    canvas.addEventListener('pointermove',e=>{if(drag){root.position.set(drag.px+e.clientX-drag.x,drag.py+e.clientY-drag.y);app?.render();}});canvas.addEventListener('pointerup',()=>{drag=undefined;});canvas.addEventListener('pointercancel',()=>{drag=undefined;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();scale(Math.min(2,Math.max(.1,root.scale.x*(e.deltaY>0?.9:1.1))));},{passive:false});
  }catch(e){pending?.destroy(true,{children:true,texture:true,textureSource:true});if(token!==generation)return;clear();error.textContent='无法打开拆分包：'+String(e);error.hidden=false;status.textContent='加载失败，已清除上一份回拼结果';}
}
element('open').onclick=()=>element<HTMLInputElement>('file').click();element<HTMLInputElement>('file').onchange=e=>{const input=e.currentTarget as HTMLInputElement,file=input.files?.[0];input.value='';if(file)void open(file);};
mode.onchange=update;element('fit').onclick=fit;zoom.oninput=()=>scale(Number(zoom.value)/100);
element('download-package').onclick=()=>{if(archive)download(archive,archive.name);};
element('download-layer').onclick=()=>{const layer=pack?.composition.layers.find(l=>l.id===selected);if(layer&&pack)download(new Blob([new Uint8Array(pack.files.get(layer.path)!).buffer],{type:'image/png'}),layer.id+'.png');};
window.addEventListener('beforeunload',()=>{observer.disconnect();clear();});
