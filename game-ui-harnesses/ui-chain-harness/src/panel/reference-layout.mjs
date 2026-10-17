import {textMetrics} from '../runtime/text-style.mjs';
import {validateDocument} from './document.mjs';
import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {surfaceGeometryForContext} from '../runtime/surface-slots.mjs';
// The source owns every box. Skin margins may reduce decoration scale, never
// rewrite row widths, button dimensions, panel aspect or spacing.
export function referenceLayoutDocument(content,layout,canvas,ctx){
 const source=layout.referenceLayout;if(source.version!==1)throw Error('REFERENCE_LAYOUT_VERSION');
 const board=ctx.canvases.presets[canvas], [px,py,width,height]=source.panel;
 if(width>board.width-32||height>board.height-32)throw Object.assign(Error('Preset does not fit this canvas; update the template.'),{code:'panel.reference-capacity'});
 const nodes=[],sourceNodes=new Map(source.nodes.map(n=>[n.id,n])),used=new Set();
 const add=(id,type,props,box,extra={})=>{const [x,y,w,h]=box;const node={id,name:id,recipeRef:type+'@1.0.0',props,size:{width:w,height:h},position:{x:x-px,y:y-py},slots:{},...extra};nodes.push(node);return node;};
 const font=(n,type)=>{const size=n.props?.style?.fontSize;return Number.isInteger(size)&&ctx.registry.recipes.find(r=>r.type===type)?.propsSchema.properties.fontSize?{fontSize:size}:{};};
 const text=(id,value,n,align='left',extra={})=>{used.add(n.id);const typography=font(n,'Text'),box=[...n.box],height=Math.max(box[3],ctx.profile.geometry.minContent,textMetrics(ctx.profile,typography).lineHeight);box[1]-=(height-box[3])/2;box[3]=height;return add(id,'text',{text:value,textStyleRef:'body',align,wrap:'word',overflow:'ellipsis',...typography},box,extra);};
 const title=source.nodes.find(n=>n.id.endsWith('.title'));
 if(title)text('heading',content.title,title,layout.presentation?.titleAlign??'center',ctx.skinGeometry?.surfaceStyles?.title?{surfaceStyle:'title'}:{});
 if(content.fields.length!==source.fields.length)throw Error('REFERENCE_LAYOUT_FIELD_COUNT');
 source.fields.forEach((binding,i)=>{
  const f=content.fields[i],n=sourceNodes.get(binding.source);if(f.type!==({Text:'text',Switch:'switch',Select:'select',ProgressBar:'progress-bar'})[n.type])throw Error('REFERENCE_LAYOUT_FIELD_TYPE');used.add(n.id);
  if(binding.label)text(f.id+'-label',f.label,sourceNodes.get(binding.label));
  if(n.type==='Text')text(f.id,f.text,n,n.id.endsWith('.value')?'right':'left');
  else if(n.type==='Switch')add(f.id,'switch',{label:'',checked:f.value,enabled:f.enabled},n.box,{controlFit:'template-box-v1'});
  else if(n.type==='Select')add(f.id,'select',{options:f.options,selectedId:f.value,placeholder:f.label,maxVisibleItems:3,enabled:f.enabled,...font(n,'Select')},n.box);
  else if(n.type==='ProgressBar'){
   add(f.id,'progress-bar',{min:0,max:f.max,value:f.value,showValue:false},n.box,{controlFit:'template-box-v1'});
   if(binding.percentage)text(f.id+'-value',Math.round(f.value/f.max*100)+'%',sourceNodes.get(binding.percentage),'center');
  }else throw Error('REFERENCE_LAYOUT_CONTROL');
 });
 const actions=content.actions??[{id:'close',label:content.closeLabel,enabled:true,variant:'primary'}];
 if(actions.length!==source.actions.length)throw Error('REFERENCE_LAYOUT_ACTION_COUNT');
 actions.forEach((a,i)=>{const n=sourceNodes.get(source.actions[i]);used.add(n.id);add(a.id,'button',{label:a.label,enabled:a.enabled,variant:a.variant??'primary',...font(n,'Button')},n.box);});
 if(source.nodes.some(n=>!used.has(n.id)))throw Error('REFERENCE_LAYOUT_UNMAPPED_NODE');
 const margin=Math.min(...nodes.flatMap(n=>[n.position.x,n.position.y,width-n.position.x-n.size.width,height-n.position.y-n.size.height]));
 const layered=ctx.surfaceLayersEnabled!==false&&ctx.skinGeometry;
 const base=layered?surfaceLayerInfo(surfaceGeometryForContext(ctx),'frame',1):null;
 const scale=base?Math.min(3,margin/Math.max(...Object.values(base.insets))):1;
 const insets=base?surfaceLayerInfo(surfaceGeometryForContext(ctx),'frame',scale).insets:{left:0,right:0,top:0,bottom:0};
 for(const n of nodes){n.position.x-=insets.left;n.position.y-=insets.top;}
 const children=nodes.map(n=>n.id);
 nodes.push({id:'body',name:'body',recipeRef:'container@1.0.0',props:{},size:{width:width-insets.left-insets.right,height:height-insets.top-insets.bottom},slots:{children},layout:{childrenMode:'free',padding:0}});
 nodes.push({id:'surface',name:'surface',recipeRef:'panel@1.0.0',props:{title:'',contentPadding:insets},size:{width,height},position:{x:(board.width-width)/2,y:(board.height-height)/2},slots:{content:['body']},...(base?{surfaceLayer:'frame',surfaceScale:scale}:{})});
 nodes.push({id:'artboard',name:'artboard',recipeRef:'container@1.0.0',props:{},size:{width:board.width,height:board.height},slots:{children:['surface']},layout:{childrenMode:'free',padding:0}});
 return validateDocument({kind:'ui_panel_document',version:'0.3',id:content.id+'-'+canvas,revision:0,title:content.title,canvas,bindings:structuredClone(ctx.binding),rootId:'artboard',nodes},ctx);
}
