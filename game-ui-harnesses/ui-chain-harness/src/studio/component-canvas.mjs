import {canvasContrast} from './canvas-contrast.mjs';
import {canvasResolution} from './canvas-resolution.mjs';
import {materialCanvas} from './material-canvas.mjs';
const $=s=>document.querySelector(s),viewport=$('#viewport');
// Studio reuses this iframe; a different fragment selects a different skin.
window.addEventListener('hashchange',()=>location.reload());
const comparison=location.hash.endsWith('&compare=1');
if(comparison){const style=document.createElement('style');style.textContent='header,aside,#status,.dialog-recovery{display:none!important}#workspace{inset:0;height:100%}';document.head.append(style);}
try{
 const id=location.hash.slice(1).split('&')[0];if(!/^[a-z][a-z0-9-]{0,48}$/.test(id))throw Error('组件版本无效');
 const base='/artifacts/'+id+'/';
 const [{Graphics,Text,Sprite},data,examples]=await Promise.all([import(base+'runtime.mjs'),fetch(base+'kit.json').then(r=>{if(!r.ok)throw Error('组件包不可用');return r.json();}),fetch(base+'examples.json').then(r=>r.json())]);
 await import(base+'gallery.mjs');Object.assign(data,examples);await initializeComponents(data,1440,1120);
 const h=window.harness,canvas=h.app.canvas;viewport.prepend(canvas);canvas.style.width='1440px';canvas.style.height='1120px';h.app.renderer.background.color="#111820";h.clear();
 const gl=h.app.renderer.gl,maxDimension=gl?Math.min(8192,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)):4096;
 const grid=new Graphics();for(let gx=0;gx<=1440;gx+=24)grid.moveTo(gx,0).lineTo(gx,1120);for(let gy=0;gy<=1120;gy+=24)grid.moveTo(0,gy).lineTo(1440,gy);grid.stroke({width:1,color:0x66849a,alpha:.12});h.app.stage.addChild(grid);
 const items=[],dialogConnections=[];
 h.cases.forEach((sample,index)=>{const x=28+(index%4)*354,y=26+Math.floor(index/4)*276;
  const plate=new Graphics().roundRect(x-8,y-6,334,252,10).fill({color:0x000000,alpha:.28});h.app.stage.addChild(plate);
  const label=new Text({text:sample.caseId+'  '+sample.type,style:{fontFamily:'sans-serif',fontSize:13,fill:'#abc0cf'}});label.position.set(x+8,y+6);h.app.stage.addChild(label);
  const n=h.make(sample.type,{size:{width:Math.min(sample.size.width,306)}},false);n.root.position.set(x+8,y+43);h.runtime.mount(n);const item={sample,n,x:x-8,y:y-6,w:334,h:252};items.push(item);
  const b=document.createElement('button');b.textContent=sample.caseId+' '+sample.type;b.onclick=()=>{locate(item);if(item.recovery)reopenDialog(item);};$('#component-list').append(b);
  if(sample.type==='Dialog'){
   const recovery=document.createElement('div');recovery.className='dialog-recovery';recovery.hidden=true;
   const message=document.createElement('p');message.textContent='弹窗已关闭';
   const reopen=document.createElement('button');reopen.type='button';reopen.textContent='重新打开';reopen.setAttribute('aria-label','重新打开 '+sample.caseId+' 弹窗');
   recovery.append(message,reopen);viewport.append(recovery);item.recovery=recovery;
   item.syncDialog=()=>{recovery.hidden=n.readState().open;b.title=recovery.hidden?'定位弹窗':'弹窗已关闭，点击定位并重新打开';};
   reopen.onclick=()=>{reopenDialog(item);viewport.focus({preventScroll:true});};
   dialogConnections.push(n.adapter.view.onClose.connect(()=>{item.syncDialog();$('#status').textContent=sample.caseId+' 弹窗已关闭 · 可在原位置重新打开，也可点击左侧组件名称';}));
   item.syncDialog();
  }
 });h.runtime.flush();for(const {n}of items)n.adapter.afterLayout?.();h.runtime.flush();
 const materials=comparison?{items:[],height:1120}:materialCanvas({h,Graphics,Text,Sprite,locate,host:$('#component-list')});
 const canvasHeight=materials.height;canvas.style.height=canvasHeight+'px';h.app.renderer.resize(1440,canvasHeight);
 if(materials.items.length){const button=document.createElement('button');button.type='button';button.id='show-materials';button.textContent='通用纹理';button.onclick=()=>locate({assetId:'materials',name:'通用纹理',bindings:['preview'],x:20,y:1120,w:1400,h:canvasHeight-1120});$('#hand').after(button);}
 const contrast=h.runtime.textColors??canvasContrast({stage:h.app.stage,skin:h.skin,Text});contrast.refresh();
 const readability=h.runtime.textColors?await fetch(base+'text-readability.json').then(r=>{if(!r.ok)throw Error('缺少文字可读性报告');return r.json();}):null;
 const reviewCount=readability?.checks?.filter(c=>c.status!=='passed').length??0;
 let lastContrast=0;const updateContrast=()=>{const now=performance.now();if(!h.runtime.textColors&&now-lastContrast>=100){lastContrast=now;contrast.refresh();}};h.app.ticker.add(updateContrast);
 let scale=1,x=0,y=0,space=false,hand=false,drag=null,located=null;
 function apply(){
  const quality=canvasResolution({width:1440,height:canvasHeight,scale,devicePixelRatio:devicePixelRatio||1,maxDimension});
  // resize(..., resolution) also invalidates Pixi's auto-resolution text
  // textures. Panning alone never reallocates the backing canvas.
  if(h.app.renderer.resolution!==quality.resolution)h.app.renderer.resize(1440,canvasHeight,quality.resolution);
  canvas.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')';$('#zoom').textContent=Math.round(scale*100)+'%';viewport.style.backgroundSize=(24*scale)+'px '+(24*scale)+'px';viewport.style.backgroundPosition=x+'px '+y+'px';window.studioCanvas.camera={x,y,scale};window.studioCanvas.renderQuality=quality;
  for(const item of items)if(item.recovery){item.recovery.style.left=(x+(item.x+item.w/2)*scale)+'px';item.recovery.style.top=(y+(item.y+item.h/2)*scale)+'px';item.recovery.style.transform='translate(-50%,-50%) scale('+scale+')';}
 }
 function reopenDialog(item){if(item.n.readState().open)return;item.n.setState({open:true});h.runtime.flush();item.syncDialog();$('#status').textContent=item.sample.caseId+' 弹窗已重新打开 · 确认后仍会关闭，可重复试玩';}
 function fit(){located=null;scale=Math.max(.15,Math.min((viewport.clientWidth-36)/1440,(viewport.clientHeight-32)/canvasHeight,1));x=(viewport.clientWidth-1440*scale)/2;y=(viewport.clientHeight-canvasHeight*scale)/2;apply();}
 function zoom(next,px=viewport.clientWidth/2,py=viewport.clientHeight/2){next=Math.max(.15,Math.min(2.5,next));x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;apply();}
 function locate(i){located=i;scale=Math.min(1.4,(viewport.clientWidth-40)/i.w,(viewport.clientHeight-40)/i.h);x=viewport.clientWidth/2-(i.x+i.w/2)*scale;y=viewport.clientHeight/2-(i.y+i.h/2)*scale;apply();$('#status').textContent=i.assetId?i.name+' · '+(i.error?'绑定效果暂不可预览':i.bindings.length?'上方原纹理，下方为包内绑定效果':'此纹理尚未绑定组件表面'):i.sample.caseId+' '+i.sample.type+' · 可直接试玩';}
 function at(e){const r=viewport.getBoundingClientRect();return {x:(e.clientX-r.left-x)/scale,y:(e.clientY-r.top-y)/scale};}
 function onComponent(e){const p=at(e);return [...items.map(({n})=>n.root),...[...h.runtime.overlay.selects].map(s=>s.view)].some(view=>{if(!view.visible)return false;const b=view.getBounds();return p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height;});}
 const form=e=>e.target.closest?.('input,textarea,select,[contenteditable=true]');
 document.addEventListener('keydown',e=>{if(e.target.closest?.('button,a,select')){e.stopImmediatePropagation();return;}if(e.code==='Space'&&!form(e)){space=true;e.preventDefault();e.stopImmediatePropagation();}},true);
 document.addEventListener('keyup',e=>{if(e.code==='Space')space=false;},true);
 window.addEventListener('blur',()=>{space=false;drag=null;});
 viewport.addEventListener('wheel',e=>{if(e.target.closest?.('.dialog-recovery')||!hand&&!e.ctrlKey&&onComponent(e))return;e.preventDefault();e.stopImmediatePropagation();const r=viewport.getBoundingClientRect();zoom(scale*Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{capture:true,passive:false});
 viewport.addEventListener('pointerdown',e=>{if(e.target.closest?.('.dialog-recovery'))return;if(e.button===1||e.button===0&&(hand||space||!onComponent(e))){e.preventDefault();e.stopImmediatePropagation();document.activeElement?.blur?.();drag={id:e.pointerId,x:e.clientX,y:e.clientY,ox:x,oy:y};viewport.setPointerCapture(e.pointerId);viewport.style.cursor='grabbing';}},{capture:true});
 viewport.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();e.stopImmediatePropagation();x=drag.ox+e.clientX-drag.x;y=drag.oy+e.clientY-drag.y;apply();},{capture:true});
 const finish=e=>{if(!drag)return;e.stopImmediatePropagation();if(viewport.hasPointerCapture(drag.id))viewport.releasePointerCapture(drag.id);drag=null;viewport.style.cursor=hand?'grab':'';};
 viewport.addEventListener('pointerup',finish,true);viewport.addEventListener('pointercancel',finish,true);
 $('#fit').onclick=fit;$('#one').onclick=()=>zoom(1);$('#minus').onclick=()=>zoom(scale/1.2);$('#plus').onclick=()=>zoom(scale*1.2);$('#hand').onclick=()=>{hand=!hand;$('#hand').setAttribute('aria-pressed',String(hand));viewport.style.cursor=hand?'grab':'';};
 window.studioCanvas={h,items,materials:materials.items,canvasHeight,camera:{},fit,locate,contrast,readability};const observer=new ResizeObserver(()=>located?locate(located):fit());observer.observe(viewport);window.addEventListener('resize',apply);fit();$('#status').textContent=h.runtime.textColors?('已使用包内正式字色'+(reviewCount?' · '+reviewCount+' 个底图状态的文字对比度需复核':' · 底图采样检查通过')):'旧包预览自动对比色 · 导出保留皮肤原始配置';
 if(readability){const link=document.createElement('a');link.href=base+'text-readability.json';link.target='_blank';link.textContent='查看文字检查';link.title=reviewCount?reviewCount+' 个底图状态需复核':'底图采样检查通过';link.style.color='#abc0cf';$('header span').before(link);}
 window.addEventListener('pagehide',()=>{observer.disconnect();window.removeEventListener('resize',apply);h.app.ticker.remove(updateContrast);for(const connection of dialogConnections)connection.disconnect();h.runtime.dispose();h.skin.dispose();h.app.destroy(true,{children:true});},{once:true});
}catch(e){$('#status').textContent='画布未能打开：'+e.message;console.error(e);}
