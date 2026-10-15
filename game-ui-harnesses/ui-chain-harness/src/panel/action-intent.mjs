import {panelOrientations} from './orientation.mjs';
import {presentation,presetHeight} from './preset-presentation.mjs';
import {validateSettingsResponse} from './settings-intent.mjs';
import {validateDocument} from './document.mjs';
import {scrollPadding} from '../runtime/scroll-geometry.mjs';
import {customIntentLayout,customPanelDocument} from './custom-layout.mjs';
import {headingPresentation} from './headings.mjs';
import {presetSurfaceDocument} from './preset-surfaces.mjs';
import {validateFormActions} from './form-actions.mjs';
const fail=(code)=>{throw Object.assign(new Error(code),{code:'panel.action-'+code});};

export async function actionPresetFromIntent(sessionInput,intentInput,config,presetId,ctx) {
  const {session,intent}=await validateSettingsResponse(sessionInput,intentInput);
  const preset=config.presets[presetId];
  if(config.version!=='1.0'||intent.panelIntentVersion!==config.intentVersion||!preset)fail('version');
  if(!intent.panel||intent.unresolved.length)fail('unresolved');
  const p=intent.panel;
  if(p.themeKey!==config.themeKey||p.panelSurface!==null)fail('theme');
  const custom=preset.custom?customIntentLayout(p,preset):null;
  if(!custom&&(['width','canvasWidth','canvasHeight','maxHeight'].some(k=>p.layout[k]!==null)||p.layout.overflow!=='error'))fail('layout');
  if(!custom&&(p.body.kind!=='column'||p.body.children.length!==1||p.body.children[0].kind!=='section'))fail('grouping');
  const section=custom?{title:custom.sections[0].title,rows:custom.sections.flatMap(s=>s.rows)}:p.body.children[0];
  if(!custom&&section.actionLayout!==null)fail('action-layout');
  const fields=[],actions=[];
  for(const [index,r] of section.rows.entries()) {
    const mapping=config.recipes[r.recipeKey],id='row'+index;
    if(!mapping||mapping.kind!==r.kind||!preset.kinds.includes(r.kind)||r.icon!==null||r.sourceRef!=='request')fail('unsupported');
    if(!custom&&r.kind!=='button'&&actions.length)fail('action-order');
    if(r.kind==='button') {
      if(r.action==='emit'&&(r.resetRows.length||r.submitRows.length))fail('targets');
      if(r.action==='submit'&&(r.resetRows.length||!r.submitRows.length))fail('targets');
      if(r.action==='reset-initial'&&(r.submitRows.length||!r.resetRows.length))fail('targets');
      if(presetId==='confirmation'&&r.action!=='emit')fail('confirmation-action');
      actions.push({id,label:r.label,enabled:r.enabled,variant:mapping.variant,action:r.action,
        targets:(r.action==='submit'?r.submitRows:r.resetRows).map(i=>'row'+i)});
    } else if(r.kind==='switch')fields.push({id,type:'switch',label:r.label,enabled:r.enabled,value:r.initial});
    else if(r.kind==='slider'){
      if(r.prefix!==''||r.suffix!==''||![r.min,r.max,r.step,r.initial].every(Number.isFinite)||r.min>=r.max||r.step<=0||r.initial<r.min||r.initial>r.max)fail('slider-range');
      fields.push({id,type:'slider',label:r.label,enabled:r.enabled,value:r.initial,min:r.min,max:r.max,step:r.step});
    } else if(r.kind==='select'){
      if(r.options.filter(o=>o.initial).length!==1||new Set(r.options.map(o=>o.label)).size!==r.options.length)fail('select-options');
      const options=r.options.map((o,i)=>({id:'option'+i,label:o.label,enabled:true}));
      fields.push({id,type:'select',label:r.label,enabled:r.enabled,options,value:options[r.options.findIndex(o=>o.initial)].id});
    } else if(r.kind==='progress'){
      if(!Number.isFinite(r.max)||r.max<=0||!Number.isFinite(r.initial)||r.initial<0||r.initial>r.max)fail('progress-range');
      fields.push({id,type:'progress-bar',label:r.label,value:r.initial,max:r.max,display:r.display,fractionDigits:r.fractionDigits});
    } else if(r.kind==='text')fields.push({id,type:'text',label:r.label,text:r.text,wrap:r.wrap});
    else if(r.kind==='checkbox')fields.push({id,type:'check-box',label:r.label,enabled:r.enabled,checked:r.initial});
    else {
      if(r.minLength>r.maxLength||r.initial.length>r.maxLength)fail('input-range');
      fields.push({id,type:'input',label:r.label,enabled:r.enabled,value:r.initial,placeholder:r.placeholder,inputType:r.inputType,
        readOnly:r.readOnly,maxLength:r.maxLength,required:r.required,minLength:r.minLength});
    }
  }
  if(fields.length<(preset.minFields??1)||fields.length>preset.maxFields||actions.length<(preset.minActions??1)||actions.length>preset.maxActions)fail('count');
  if(preset.shape){const shape={};for(const r of section.rows)shape[r.kind]=(shape[r.kind]??0)+1;if(Object.keys(shape).length!==Object.keys(preset.shape).length||Object.entries(preset.shape).some(([k,n])=>shape[k]!==n))fail('preset-shape');if(actions.some(a=>a.action!=='emit'))fail('preset-action');}
  if(preset.custom&&!fields.length&&!actions.length)fail('empty');
  const targetTypes=preset.custom?['input','check-box','switch','slider','select']:['input','check-box'];
  for(const a of actions)if(new Set(a.targets).size!==a.targets.length||a.targets.some(id=>!fields.some(f=>f.id===id&&targetTypes.includes(f.type))))fail('targets');
  if(custom)validateFormActions({policy:preset.formActions,request:session.context.request.text,fields,actions,layoutBody:custom.body});
  const content={version:'1.0',id:p.id,title:p.title,sectionTitle:section.title,presetId,fields,actions,...(custom?{overflow:p.layout.overflow,layout:structuredClone(p.layout),layoutBody:custom.body}:{})};
  const documents=Object.fromEntries(panelOrientations(ctx.orientation).map(canvas=>[canvas,actionPresetDocument(content,config,canvas,ctx)]));
  const behavior={version:'1.0',fields:structuredClone(fields),actions:structuredClone(actions),dismissOnEmit:preset.dismissOnEmit};
  return {content,documents,behavior,provenance:{sessionSha256:session.sha256,contextSha256:session.context.sha256,intentVersion:intent.panelIntentVersion}};
}

export function actionPresetDocument(content,config,canvas,ctx) {
  if(content.layoutBody)return customPanelDocument(content,config,canvas,ctx);
  if(config.presentation?.version==='2.0'&&ctx.surfaceLayersEnabled!==false&&config.presets[content.presetId].surface==='panel')return presetSurfaceDocument(content,config,canvas,ctx);
  const preset=config.presets[content.presetId],o=preset[canvas],board=ctx.canvases.presets[canvas],g=config.geometry;
  const padding=preset.surface==='dialog'?ctx.profile.padding:g.padding,bodyWidth=o.width-2*padding,nodes=[],policy=presentation(config.presentation),scrolling=preset.custom&&content.overflow==='scroll';
  if(scrolling&&ctx.binding.sourceKind==='imported'&&!ctx.scrollInsets)fail('scroll-insets');
  const pad=scrolling?scrollPadding(ctx.profile,ctx.scrollInsets??{left:0,right:0,top:0,bottom:0}):null;
  const w=scrolling?bodyWidth-pad.left-pad.right-ctx.profile.geometry.scrollbarWidth-ctx.profile.geometry.scrollbarGap:bodyWidth;
  const add=(id,type,props,width,height,slots={},extra={})=>{nodes.push({id,name:id,recipeRef:type+'@1.0.0',props,size:{width,height},slots,...extra});return id;};
  const text=(id,value,height,wrap='word',surfaceStyle)=>{const style=surfaceStyle?headingPresentation(ctx,surfaceStyle,w,height,{layered:policy.version==='2.0'&&ctx.surfaceLayersEnabled!==false}):{height};return add(id,'text',{text:value,textStyleRef:'body',wrap,overflow:'error'},w,style.height,{},style.surfaceStyle?{surfaceStyle:style.surfaceStyle,...(style.surfaceTextInsets?{surfaceTextInsets:style.surfaceTextInsets}:{})}:{});};
  const children=[text('heading',content.title,g.headingHeight,'word','title')];
  nodes[0].size.width=bodyWidth;
  nodes[0].props.align=policy.titleAlign;
  if(policy.sectionHeading==='show')children.push(text('section-heading',content.sectionTitle,g.labelHeight,'word','section'));
  for(const f of content.fields) {
    if(f.type==='check-box'||f.type==='switch')children.push(add(f.id,f.type,{label:f.label,checked:f.type==='switch'?f.value:f.checked,enabled:f.enabled},w,f.type==='switch'?g.switchHeight:g.checkboxHeight));
    else {
      // Native rows require a non-empty label. Body-only text repeats its copy
      // in that field for identification; render the identical string once.
      if(f.label&&!(f.type==='text'&&f.label===f.text))children.push(text(f.id+'-label',f.label,g.labelHeight));
      if(f.type==='progress-bar'){
        children.push(add(f.id,'progress-bar',{min:0,max:f.max,value:f.value,showValue:false},w,g.progressHeight));
        children.push(text(f.id+'-value',(f.display==='percent'?f.value/f.max*100:f.value).toFixed(f.fractionDigits)+(f.display==='percent'?'%':''),g.labelHeight));
      }
      else if(f.type==='slider')children.push(add(f.id,'slider',{value:f.value,min:f.min,max:f.max,step:f.step,showValue:true,enabled:f.enabled},w,g.sliderHeight));
      else if(f.type==='select')children.push(add(f.id,'select',{options:f.options,selectedId:f.value,placeholder:f.label,maxVisibleItems:3,enabled:f.enabled},w,g.selectHeight));
      else if(f.type==='text')children.push(text(f.id,f.text,g.textHeight,f.wrap));
      else children.push(add(f.id,'input',{value:f.value,placeholder:f.placeholder,inputType:f.inputType,readOnly:f.readOnly,maxLength:f.maxLength,enabled:f.enabled},w,g.inputHeight));
    }
  }
  if(scrolling){
    const fields=children.splice(1),natural=fields.reduce((sum,id)=>sum+nodes.find(n=>n.id===id).size.height,0)+Math.max(0,fields.length-1)*g.gap;
    const available=o.height-padding*2-nodes[0].size.height-g.gap-(content.actions.length?g.buttonHeight+g.gap:0);
    if(w<ctx.profile.geometry.minContent||available-pad.top-pad.bottom<ctx.profile.geometry.minContent)fail('scroll-capacity');
    const inner=add('scroll-content','container',{},w,Math.max(24,natural),{children:fields},{layout:{childrenMode:'flow',direction:'column',gap:g.gap,padding:0}});
    children.push(add('custom-scroll','scroll-view',{axis:'vertical',scrollbar:'auto'},bodyWidth,available,{content:[inner]}));
  }
  const buttonWidth=content.actions.length?(bodyWidth-g.gap*(content.actions.length-1))/content.actions.length:0;
  const buttons=content.actions.map(a=>add(a.id,'button',{label:a.label,enabled:a.enabled,variant:a.variant},buttonWidth,g.buttonHeight,{}, {sizing:{widthMode:'fill'}}));
  if(buttons.length)children.push(add('actions','container',{},bodyWidth,g.buttonHeight,{children:buttons},{layout:{childrenMode:'flow',direction:'row',gap:g.gap,padding:0}}));
  const height=presetHeight({policy:scrolling?{...policy,height:'fixed'}:policy,width:o.width,height:o.height,board,padding,children:children.map(id=>nodes.find(n=>n.id===id).size.height),gap:g.gap});
  add('body','container',{},bodyWidth,height-2*padding,{children},{layout:{childrenMode:'flow',direction:'column',gap:g.gap,padding:0}});
  const props=preset.surface==='dialog'?{title:'',open:true,modal:true,closeOnBackdrop:false,actions:[]}
    :{title:'',contentPadding:{left:padding,right:padding,top:padding,bottom:padding}};
  add('surface',preset.surface,props,o.width,height,{content:['body']},{position:{x:(board.width-o.width)/2,y:(board.height-height)/2},...(policy.version==='2.0'&&ctx.surfaceLayersEnabled!==false?{surfaceLayer:'frame'}:{})});
  add('artboard','container',{},board.width,board.height,{children:['surface']},{layout:{childrenMode:'free',padding:0}});
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:content.id+'-'+canvas,revision:0,title:content.title,canvas,bindings:structuredClone(ctx.binding),rootId:'artboard',nodes},ctx);
}

export {applyPresetAction} from './action-behavior.mjs';
