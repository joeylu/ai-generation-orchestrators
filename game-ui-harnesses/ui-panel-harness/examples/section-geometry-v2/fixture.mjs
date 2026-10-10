import { headingSpec, flatten } from '../section-headings-v1/fixture.mjs';
export { flatten };
export const selectRequest = { requestVersion:'0.1',id:'single-select',target:'pixi',
  text:'做一个角色选择界面\n\n【补充回答】\n问题：角色选择界面中需要提供哪些角色选项？默认选中哪一个？\n回答：男女两个选项 默认男' };
/** Authored fixture with the reported structure; never an online task export. */
export function singleControlSpec(panel,catalog,kind='select',options={}) {
  const spec=structuredClone(headingSpec(panel,catalog,{themeId:'modern-mint-light',...options}));
  const ref=kind=>{const recipe=catalog.recipes.find(recipe=>recipe.kind===kind);return{id:recipe.id,version:recipe.version};};
  const base={id:'row0',label:'性别',enabled:true,bind:'row0',event:'role.genderChanged'};
  let row,state;
  if(kind==='select') {
    row={...base,kind,recipe:ref('select-row')};
    state={id:'row0',type:'enum',initial:'male',options:[{id:'male',label:'男'},{id:'female',label:'女'}]};
  } else if(kind==='switch') {row={...base,kind,label:'声音',recipe:ref('switch-row')};state={id:'row0',type:'boolean',initial:true};}
  else if(kind==='progress') {row={id:'row0',kind,label:'进度',recipe:ref('progress-row'),bind:'row0',format:{mode:'percent',fractionDigits:0}};state={id:'row0',type:'progress',initial:57,max:100};}
  else if(kind==='text') {row={id:'row0',kind,label:'角色',recipe:ref('text-row'),text:'男'};}
  else if(kind==='button') {row={id:'row0',kind,label:'',buttonLabel:'开始',recipe:ref('button-row'),enabled:true,event:'role.start',action:{kind:'emit'}};}
  else if(kind==='input') {row={...base,kind,label:'角色名',recipe:ref('input-row'),placeholder:'请输入角色名',inputType:'text',readOnly:false,validation:{required:false,minLength:0,requiredMessage:'请输入角色名',minLengthMessage:'角色名太短'}};state={id:'row0',type:'string',initial:'测试',maxLength:12};}
  else if(kind==='slider') return panel.validatePanelSpec(spec);
  else throw Error('FIXTURE_CONTROL_KIND');
  spec.title='角色选择';spec.sections[0].title='角色设置';spec.sections[0].rows=[row];spec.state=state?[state]:[];
  return panel.validatePanelSpec(spec);
}
export function selectIntent(context) {
  const theme=context.catalog.themes.find(theme=>theme.id==='modern-mint-light');
  return{panelIntentVersion:'0.10',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'角色选择',
    themeKey:`${theme.id}@${theme.version}`,panelSurface:null,layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto'},
    body:{kind:'column',children:[{kind:'section',title:'角色设置',actionLayout:null,rows:[{kind:'select',label:'性别',recipeKey:'settings.select@0.1.0',sourceRef:'request',icon:null,enabled:true,
      options:[{label:'男',initial:true},{label:'女',initial:false}]}]}]}}};
}
export const geometryCases = ['select','switch','progress','text','button','input','slider'];
