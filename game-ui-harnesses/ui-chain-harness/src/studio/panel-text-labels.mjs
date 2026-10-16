import {CanvasTextMetrics} from 'pixi.js';
import {textEditFields} from '../panel/text-edit.mjs';
import {surfaceTextProfile} from '../runtime/text-style.mjs';
import {percentLabel} from '../runtime/controls.mjs';

const literal=value=>String(value).replace(/\s+/g,' ');
const buttonText=button=>button?.labelView??button?._views?.textView;
const tolerance=.1;

// Inspect the prepared renderer without changing adapters, selection, play state
// or shared styles. Old source copy is intentionally outside this extra gate.
export function assertEditedTextLabels(scene,baseDocument,ctx){
  const originals=new Map(baseDocument.nodes.map(node=>[node.id,node]));
  const skin=scene.runtime.skin;
  let expectedFontSize;
  const error=(node,field,reason)=>{
    const failure=new Error(`${node.name||node.id} · ${field.label}：${reason} 请缩短文案或扩大控件。`);
    failure.code='edit.text-render';failure.nodeId=node.id;failure.field=field.id;
    throw failure;
  };
  const pads=roles=>{
    const values=roles.map(role=>skin.insets(role));
    return Object.fromEntries(['left','right','top','bottom'].map(key=>[key,Math.max(0,...values.map(value=>value[key]))]));
  };
  const measure=(node,field,text,value,width,height,{raw=false,drawn=true}={})=>{
    const expected=raw?String(value):literal(value);
    // Empty Dialog titles have no text object. Other empty labels may also be
    // omitted by PixiUI; there are no glyphs whose readability needs checking.
    if(!expected&&!text)return;
    if(!text?.style||typeof text.text!=='string')error(node,field,'无法核验当前字体的完整显示。');
    if(expectedFontSize!==undefined&&text.style.fontSize!==expectedFontSize)error(node,field,'实际字号与请求字号不一致。');
    if(drawn&&text.text!==expected)error(node,field,'当前字体显示被省略或与完整文案不一致。');
    if(!expected)return;
    let metrics;
    try{metrics=CanvasTextMetrics.measureText(expected,text.style);}
    catch{error(node,field,'无法完成当前字体测量。');}
    if(![width,height,metrics.width,metrics.height].every(Number.isFinite)||width<0||height<0||metrics.width>width+tolerance||metrics.height>height+tolerance)
      error(node,field,'当前字体超出文字安全区。');
  };
  const button=(node,field,view,value)=>{
    const pad=pads(view?.skinRoles??[]),width=view?.defaultView?.width,height=view?.defaultView?.height;
    measure(node,field,buttonText(view),value,width-pad.left-pad.right,height-pad.top-pad.bottom);
  };
  for(const node of scene.document.nodes){
    const original=originals.get(node.id);
    if(!original)continue; // Structure is already checked by validateSizeEdit.
    const before=new Map(textEditFields({...original,locked:false},ctx).map(field=>[field.id,field.value])),fontChanged=node.props.fontSize!==original.props.fontSize;
    const changed=textEditFields({...node,locked:false},ctx).filter(field=>fontChanged||field.value!==before.get(field.id));
    const handle=scene.runtime.handles.get(node.id),adapter=handle?.adapter,view=adapter?.view,type=handle?.recipe.type,p=node.props,size=handle?.size;
    const profile=surfaceTextProfile(skin.profile,p,node.surfaceFontSize),g=profile.geometry;
    if(fontChanged&&['Slider','ProgressBar'].includes(type)&&p.showValue)changed.push({id:'value',label:'数值文字',value:percentLabel(handle.readState().value,p.min,p.max)});
    if(!changed.length)continue;
    expectedFontSize=fontChanged?profile.fontSize:undefined;
    if(!handle||!adapter||!view||!size)error(node,changed[0],'当前控件尚未完成显示。');
    if(fontChanged&&type==='List'&&p.inventory){
      const width=adapter.geometry.details.contentWidth,box=adapter.geometry.quantityBox;
      for(const cell of adapter.cells??[])if(cell.item){
        measure(node,{id:`items.${cell.slotIndex}.quantity`,label:'格内数量'},cell.quantity,String(cell.item.quantity),box.width-4,box.height,{raw:true});
        const selected=handle.readState().selectedId===cell.item.id;
        measure(node,{id:`items.${cell.slotIndex}.description`,label:'物品说明'},adapter.detailDescription,cell.item.description,width,1e9,{raw:true,drawn:selected});
      }
      for(const [id,text]of [['detailTitle',adapter.detailTitle],['detailQuantity',adapter.detailQuantity],['detailSlot',adapter.detailSlot]])
        measure(node,{id,label:'详情文字'},text,text?.text??'',width,1e9,{raw:true});
    }
    for(const field of changed){
      const index=Number(field.id.split('.')[1]);
      if(type==='Text')measure(node,field,adapter.text,field.value,size.width,size.height,{raw:true});
      else if(type==='Button')button(node,field,view,field.value);
      else if(type==='Switch'){
        const states=view?.views;
        if(!states||states.length!==2)error(node,field,'无法核验开关的全部显示状态。');
        for(const state of states)measure(node,field,state.children?.[2],field.value,size.width-profile.markSize*2-g.labelGap,size.height);
      }else if(type==='CheckBox')measure(node,field,view?.labelText,field.value,size.width-profile.markSize-g.labelGap,g.lineHeight);
      else if(type==='RadioGroup'){
        const width=p.direction==='row'?(size.width-Math.max(0,p.options.length-1)*profile.gap)/Math.max(1,p.options.length):size.width;
        measure(node,field,adapter.items?.[index]?.labelText,field.value,width-profile.markSize-g.labelGap,g.lineHeight);
      }else if(type==='Panel'){
        const pad=p.contentPadding??skin.insets('skin.surface.panel');
        measure(node,field,view?.children?.[1],field.value,size.width-pad.left-pad.right,g.lineHeight);
      }else if(type==='Dialog'){
        if(field.id==='title')measure(node,field,view?.titleText,field.value,size.width-2*view.dialogPadding,g.lineHeight);
        else button(node,field,adapter.buttons?.[index],field.value);
      }else if(type==='List'&&p.inventory){
        // Every occupied item's full name is drawn in the same scrollable
        // detail region. Probe with its real style without changing selection.
        measure(node,field,adapter.detailName,field.value,adapter.geometry.detailName.width,1e9,{raw:true,drawn:handle.readState().selectedId===p.items[index]?.id});
      }else if(type==='Tabs'||type==='List')button(node,field,adapter.rows?.[index],field.value);
      else if(type==='Slider')measure(node,field,view?.value1Text,field.value,size.width,size.height-profile.thumbSize-profile.trackHeight);
      else if(type==='ProgressBar')measure(node,field,view?.children?.[1],field.value,size.width,size.height-profile.trackHeight-g.labelGap);
      else if(type==='Input'){
        const pad=skin.insets('skin.field.normal');
        // The placeholder stays measurable while an entered value hides it.
        measure(node,field,view?.placeholder,field.value,size.width-pad.left-pad.right,size.height-pad.top-pad.bottom,{raw:true});
      }else if(type==='Select'){
        const pad=skin.insets('skin.field.normal'),selected=p.options.find(option=>option.id===handle.readState().selectedId);
        const displayed=selected?.label??p.placeholder;
        if(field.id!=='placeholder')button(node,field,view?.rows?.[index],field.value);
        const width=size.width-pad.left-pad.right-2*(g.indicatorWidth+g.labelGap),height=size.height-pad.top-pad.bottom;
        for(const closed of [view?.openButton,view?.closeButton])
          measure(node,field,buttonText(closed),field.value,width,height,{drawn:literal(displayed)===literal(field.value)});
      }else error(node,field,'该控件暂不支持显示文案核验。');
    }
  }
}
