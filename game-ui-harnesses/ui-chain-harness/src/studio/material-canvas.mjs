const names={title:'主标题纹理',section:'分组标题纹理',panel:'面板底纹'};

// Inspect the loaded, verified skin. Preview nodes belong only to this canvas.
export function materialCanvas({h,Graphics,Text,Sprite,locate,host}){
 const assets=h.skin.surfaceGeometry?.materialAssets??[],styles=h.skin.surfaceGeometry?.surfaceStyles??{},items=[];
 const label=(text,x,y,size=14)=>{const view=new Text({text,style:{fontFamily:'sans-serif',fontSize:size,fill:'#c8d0db'}});view.position.set(x,y);view.eventMode='none';h.app.stage.addChild(view);return view;};
 const heading=document.createElement('h3');heading.textContent='通用纹理 · '+assets.length;host.append(heading);
 if(!assets.length){const note=document.createElement('p');note.textContent='此组件包未包含通用纹理';host.append(note);return {items,height:1120};}
 label('通用纹理 · 原图与绑定效果',28,1136,20);
 for(const [index,asset]of assets.entries()){
  const bindings=Object.entries(styles).filter(([,style])=>style.layers.some(layer=>layer.assetId===asset.assetId)).map(([key])=>key);
  const key=bindings[0],name=names[key]??asset.assetId,x=20+(index%3)*472,y=1180+Math.floor(index/3)*402,w=452,height=382;
  h.app.stage.addChild(new Graphics().roundRect(x,y,w,height,10).fill({color:0x000000,alpha:.28}));
  label(name,x+16,y+14,16);label('原纹理 · '+asset.width+' × '+asset.height,x+16,y+44,12);
  const rawBox={x:x+16,y:y+68,width:420,height:156},checker=new Graphics();
  for(let cy=0;cy<rawBox.height;cy+=12)for(let cx=0;cx<rawBox.width;cx+=12)checker.rect(rawBox.x+cx,rawBox.y+cy,Math.min(12,rawBox.width-cx),Math.min(12,rawBox.height-cy)).fill((cx/12+cy/12)%2?0x34414c:0x26313b);
  checker.eventMode='none';h.app.stage.addChild(checker);
  const raw=new Sprite({texture:h.skin.textures.get(asset.assetId)}),factor=Math.min(rawBox.width/raw.texture.width,rawBox.height/raw.texture.height);
  raw.scale.set(factor);raw.position.set(rawBox.x+(rawBox.width-raw.width)/2,rawBox.y+(rawBox.height-raw.height)/2);raw.eventMode='none';h.app.stage.addChild(raw);
  label(bindings.length?'绑定效果 · '+bindings.map(k=>names[k]??k).join(' / '):'尚未绑定组件表面',x+16,y+240,12);
  let preview=null,error=null;
  if(key){try{
   const isPanel=key==='panel';
   preview=isPanel?h.make('Panel',{id:'material-preview-'+index,size:{width:420,height:100}},false):h.runtime.create({id:'material-preview-'+index,recipeRef:'text@1.0.0',size:{width:420,height:100},surfaceStyle:key,surfaceBand:'reference-v1',props:{text:key==='title'?'主标题效果':'分组标题效果',textStyleRef:'body',align:'center',wrap:'word',overflow:'ellipsis'}});
   preview.root.position.set(x+16,y+266);h.runtime.mount(preview);
  }catch(e){error=e.message;label('此绑定效果暂不可预览',x+16,y+286,14);}}
  const item={assetId:asset.assetId,name,bindings,raw,preview,error,x,y,w,h:height};items.push(item);
  const button=document.createElement('button');button.type='button';button.textContent=name;button.setAttribute('aria-label','查看'+name+'原图与绑定效果');button.onclick=()=>locate(item);host.append(button);
 }
 h.runtime.flush();return {items,height:1180+Math.ceil(assets.length/3)*402};
}
