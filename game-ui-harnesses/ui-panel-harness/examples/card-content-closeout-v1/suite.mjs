import {SECTION_PANEL_TEN_SUITE,sectionPanelTenFixture} from '../section-panels-ten-v1/suite.mjs';
/** Five unchanged requests. Fixtures are driver specimens, never model inputs. */
export const CARD_CONTENT_CLOSEOUT_SUITE=Object.freeze(['G25','G14','G16','G03','G54'].map(id=>SECTION_PANEL_TEN_SUITE.find(item=>item.id===id)));
const text=(label,value)=>({kind:'text',label,recipeKey:'settings.text@0.1.0',text:value,wrap:'word'});
const progress=(initial,max)=>({kind:'progress',label:'示例进度',recipeKey:'settings.progress@0.1.0',initial,max,display:'percent',fractionDigits:0});
const button=label=>({kind:'button',label,recipeKey:'settings.button.primary@0.1.0',enabled:true,action:'emit',resetRows:[],submitRows:[]});
const section=(title,rows)=>({kind:'section',title,actionLayout:null,rows:rows.map(row=>({...row,sourceRef:'request',icon:null}))});
export function cardContentCloseoutFixture(context,item,referenceIntent){
 const intent=sectionPanelTenFixture(context,item,referenceIntent);
 if(item.id==='G16')intent.panel.body={kind:'row',children:[
  section('示例：初次通关',[text('成就名称','示例：初次通关'),text('示例条件','完成任意关卡'),progress(0,1),text('示例状态','未完成（预览）')]),
  section('示例：持续探索',[text('成就名称','示例：持续探索'),text('示例条件','累计探索5个区域'),progress(2,5),text('示例状态','进行中（预览）')]),
 ]};
 if(item.id==='G25')intent.panel.body={kind:'row',children:[section('示例：资源包',[text('示例价格','100金币'),text('示例内容','资源补给'),button('购买')]),section('示例：体力包',[text('示例价格','80金币'),text('示例内容','体力补给'),button('购买')])]};
 if(item.id==='G14')intent.panel.body={kind:'row',children:[section('示例：森林巡逻',[text('示例目标','完成一次巡逻'),progress(1,3),button('查看')]),section('示例：遗迹探索',[text('示例目标','调查遗迹入口'),progress(0,1),button('查看')])]};
 return intent;
}
