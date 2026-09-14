// Real pointer + independent source-over pixel checks. No inferred palette.
export async function verifySelectMenuHighlights({page,canvas,at,node,observed,resources,saveScreenshot,canvasSize}) {
 const a=node.props.appearance,h=a.menuHighlights;if(!h)return [];
 const safe=a.popupContentLayout,popup=observed.popupBounds;
 if(!observed.popupOpen||!popup)throw Error('SELECT_MENU_HIGHLIGHTS_POPUP_CLOSED');
 const scale=popup.width/a.popupCanvas.width,rowHeight=safe.height/node.props.options.length;
 const selected=node.props.options.findIndex(o=>o.id===observed.value),other=node.props.options.findIndex((o,i)=>i!==selected);
 const checks=[];
 const capture=async(phase,hoverIndex)=>{
  if(hoverIndex<0)await page.mouse.move(1,1);
  else await page.mouse.move(...await at([popup.x+(safe.x+safe.width/2)*scale,popup.y+(safe.y+(hoverIndex+.5)*rowHeight)*scale]));
  const shot=await saveScreenshot(phase);
  const pixels=await page.evaluate(async({data,background,popup,safe,scale,rowHeight,options,selected,hoverIndex,h,appearance,canvasSize})=>{
   const decode=async(s,w,height)=>{const im=new Image();im.src='data:image/png;base64,'+s;await im.decode();const c=document.createElement('canvas');c.width=w??im.width;c.height=height??im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0,c.width,c.height);return {width:c.width,samplingScale:im.width/c.width,data:ctx.getImageData(0,0,c.width,c.height).data};};
   const actual=await decode(data,canvasSize?.width,canvasSize?.height),base=await decode(background,Math.round(popup.width),Math.round(popup.height));
   // CSS-fitted Studio screenshots have a two-device-pixel filter footprint.
   // Keep the color tolerance fixed; exclude only that measured boundary footprint.
   const guard=Math.max(1,Math.ceil(2/actual.samplingScale));
   const rows=[];
   for(let i=0;i<options.length;i++){
    const state=i===selected?h.selected:i===hoverIndex?h.hover:null;
    if(!state)continue;
    const s=state.insets,r={x:s.left,y:s.top,width:safe.width-s.left-s.right,height:rowHeight-s.top-s.bottom};
    const def=appearance.optionIcons?.items.find(q=>q.optionId===options[i].id);
    const label=def?.labelLayout??{x:10,y:0,width:safe.width-20,height:rowHeight};
    const excluded=[label,...(def?.icon?[def.icon.layout]:[])];
    const rgb=state.color.slice(1).match(/../g).map(c=>parseInt(c,16));let seen=0,bad=0;
    // Ignore rounded edges and all declared icon/text layout regions, not their colors.
    for(let y=Math.ceil(r.y+guard);y<r.y+r.height-guard;y++)for(let x=Math.ceil(r.x+guard);x<r.x+r.width-guard;x++){
     if(state.cornerRadius&&!(x>=r.x+state.cornerRadius&&x<r.x+r.width-state.cornerRadius||y>=r.y+state.cornerRadius&&y<r.y+r.height-state.cornerRadius))continue;
     if(excluded.some(q=>x>=q.x-guard&&y>=q.y-guard&&x<q.x+q.width+guard&&y<q.y+q.height+guard))continue;
     const px=Math.round((safe.x+x)*scale),py=Math.round((safe.y+i*rowHeight+y)*scale),off=(py*base.width+px)*4;
     if(base.data[off+3]!==255)continue;
     const actualOff=((Math.round(popup.y)+py)*actual.width+Math.round(popup.x)+px)*4;
     seen++;if(rgb.some((c,k)=>Math.abs(actual.data[actualOff+k]-(c*state.alpha+base.data[off+k]*(1-state.alpha)))>6))bad++;
    }
    rows.push({optionId:options[i].id,kind:i===selected?'selected':'hover',checkedPixels:seen,badPixels:bad,pass:seen>=3&&bad/seen<=.02});
   }
   return rows;
  },{data:shot.bytes.toString('base64'),background:resources[a.popupImage],popup,safe,scale,rowHeight,options:node.props.options,selected,hoverIndex,h,appearance:a,canvasSize});
  checks.push({slot:'menu-highlights/'+phase,visible:true,screenshot:shot.path,sha256:shot.sha256,pixels,pass:pixels.length>0&&pixels.every(p=>p.pass)});
 };
 await capture('selected',-1);await capture('selected-hover',selected);
 if(other>=0)await capture('unselected-hover',other);
 await capture('pointer-out',-1);
 return checks;
}
