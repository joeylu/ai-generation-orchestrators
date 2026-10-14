/** Deterministic static-image fixtures; no generated portrait artwork. */
import {singleControlSpec} from '../section-geometry-v2/fixture.mjs';
export const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
export function imageSpec(panel,catalog,{source=null,fit='contain',mode='light',cards=false}={}) {
  const spec=singleControlSpec(panel,catalog,'slider');
  const theme=catalog.themes.find(theme=>theme.id===`modern-mint-${mode}`&&theme.headingStyle==='concise-v2');
  Object.assign(spec,{panelSpecVersion:'0.15',theme:{id:theme.id,version:theme.version},appearance:null,actionLayouts:[],buttonStyles:[],buttonFonts:[],titleBar:null,textLayouts:[],frame:null});
  const image=(id,label)=>({id,kind:'image',recipe:{id:'content.image',version:'0.1.0'},label,source,width:'fill',height:180,fit});
  spec.sections[0].rows.unshift(image('portrait','角色肖像'));
  spec.sections[0].title=spec.title;
  if(cards){
    spec.id='role-images';spec.title='选择角色';spec.state=[];
    spec.sections=['战士','魔法师','弓箭手'].map((name,i)=>({id:'role'+i,title:name,rows:[image('portrait'+i,name+'肖像'),
      {id:'name'+i,kind:'text',recipe:{id:'settings.text',version:'0.1.0'},label:'角色',text:name},
      {id:'choose'+i,kind:'button',recipe:{id:'settings.button.primary',version:'0.1.0'},label:'',buttonLabel:'选择'+name,enabled:true,event:'panel.choose'+i,action:{kind:'emit'}}]}));
    spec.layout={...spec.layout,width:1000,maxHeight:600,body:{id:'roles',kind:'row',width:'fill',gap:20,align:'start',children:spec.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}))}};
    spec.canvas={width:1120,height:680};
  }
  return spec;
}
export const imageRequest={requestVersion:'0.1',id:'role-images',text:'做一个角色选择界面，战士、魔法师、弓箭手三个角色并排，每个角色留肖像图片槽，显示名称和选择按钮，暂无肖像素材。',target:'pixi'};
export function imageIntent(context,{source=null}={}) {
  const theme=context.catalog.themes.find(value=>value.id==='modern-mint-light'&&value.headingStyle?.startsWith('concise-v'));
  return {panelIntentVersion:'0.11',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'选择角色',themeKey:`${theme.id}@${theme.version}`,panelSurface:null,
    layout:{width:1000,canvasWidth:1120,canvasHeight:680,maxHeight:600,overflow:'error'},body:{kind:'row',children:['战士','魔法师','弓箭手'].map((name,index)=>({kind:'section',title:name,actionLayout:null,rows:[
      {kind:'image',label:name+'肖像',recipeKey:'content.image@0.1.0',sourceRef:'request',icon:null,source:Array.isArray(source)?source[index]:source,width:'fill',height:180,fit:'contain'},
      {kind:'text',label:'角色',text:name,wrap:'none',recipeKey:'settings.text@0.1.0',sourceRef:'request',icon:null},
      {kind:'button',label:'选择'+name,recipeKey:'settings.button.primary@0.1.0',sourceRef:'request',icon:null,enabled:true,action:'emit',resetRows:[],submitRows:[]},
    ]}))}}};
}

/** New authored card composition. Legacy fixtures above keep their explicit copy. */
export function conciseRoleSpec(panel,catalog,{mode='light'}={}) {
  const spec=imageSpec(panel,catalog,{mode,cards:true});
  for(const section of spec.sections){
    section.rows=section.rows.filter(row=>row.kind!=='text');
    section.rows[0].label='待添加肖像';
    section.rows[1].buttonLabel='选择';
  }
  spec.canvas.height=560;
  return spec;
}
export function conciseRoleIntent(context,options={}) {
  const intent=imageIntent(context,options);
  for(const section of intent.panel.body.children){
    section.rows=section.rows.filter(row=>row.kind!=='text');
    section.rows[0].label=section.rows[0].source===null?'待添加肖像':'肖像';
    section.rows[1].label='选择';
  }
  intent.panel.layout.canvasHeight=560;
  return intent;
}
