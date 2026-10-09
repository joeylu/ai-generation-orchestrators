import {createPlanningContext} from '../../src/planning-context.mjs';
import {arrangeIntentSpec,materializePanelIntent} from '../../src/panel-intent.mjs';
import {roleRequest,roleIntent} from '../adaptive-v1/fixture.mjs';

export const layoutSettings = width => ({width:width??null,canvasWidth:null,canvasHeight:null,maxHeight:640,overflow:'auto',body:null,sourceQuote:'Deterministic layout fixture.'});

/** Offline fixtures. The text describes examples; no model inference is asserted. */
export async function focusedLayoutFixtures(catalog) {
  const theme=catalog.themes.find(theme=>theme.id==='modern-blue-dark'),context=await createPlanningContext(roleRequest,catalog),intent=roleIntent(context,theme);
  intent.panel.body.children[0].rows[1].recipeKey='settings.button.primary@0.1.0';
  intent.panel.body.children[0].rows[2].recipeKey='settings.button.secondary@0.1.0';
  const form=(await materializePanelIntent(context,intent)).spec;
  form.provenance={kind:'programmatic-fixture',description:'Owned offline form/menu/dialog layout fixture; not a model generation result.',assumptions:[]};
  const menu=structuredClone(form);menu.id='focused-menu';menu.title='主菜单';menu.sections[0].title='主菜单';menu.state=[];
  menu.sections[0].rows=menu.sections[0].rows.slice(1).map((r,i)=>({...r,buttonLabel:i?'设置':'开始游戏',action:{kind:'emit'}}));
  menu.sections[0].rows.push({...structuredClone(menu.sections[0].rows[1]),id:'exit',buttonLabel:'退出游戏',event:'menu.exit'});
  const dialog=structuredClone(menu);dialog.id='focused-dialog';dialog.title='删除存档';dialog.sections[0].title='删除存档';
  Object.assign(dialog,{panelSpecVersion:'0.13',appearance:null,actionLayouts:[],buttonStyles:[],buttonFonts:[],titleBar:null,textLayouts:[{rowId:'message',wrap:'word'}]});
  dialog.sections[0].rows=[{id:'message',kind:'text',recipe:{id:'settings.text',version:'0.1.0'},label:'确认删除',text:'删除后，这份存档将无法恢复。请确认已经保存了需要保留的进度，再继续操作。'},
    {...structuredClone(menu.sections[0].rows[1]),id:'cancel',buttonLabel:'保留存档',event:'dialog.cancel'},
    {...structuredClone(menu.sections[0].rows[0]),id:'delete',buttonLabel:'删除存档',event:'dialog.delete',recipe:{id:'settings.button.danger',version:'0.1.0'}}];
  return Object.fromEntries(Object.entries({menu,form,dialog}).map(([id,spec])=>[id,arrangeIntentSpec(spec,layoutSettings(),theme)]));
}
