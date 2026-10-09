/** Owned deterministic fixture, not a natural-language/model acceptance result. */
export function semanticSettingsFixture(catalog,base) {
  const spec=structuredClone(base),theme=catalog.themes.find(theme=>theme.id==='modern-blue-dark');
  spec.panelSpecVersion='0.10';spec.theme={id:theme.id,version:theme.version};spec.tabs=null;spec.appearance=null;spec.buttonStyles=[];
  spec.canvas={width:1280,height:720};spec.layout={...spec.layout,width:760,padding:24,gap:12,sectionGap:20,labelWidth:160,titleHeight:48,sectionTitleHeight:32,maxHeight:640,overflow:'error',
    body:{id:'settings-body',kind:'column',width:'fill',gap:20,align:'start',children:[{kind:'section',sectionId:'preferences',width:'fill'},{kind:'section',sectionId:'actions',width:'fill'}]}};
  const reset=spec.sections[0].rows.pop();reset.recipe={id:'settings.button.secondary',version:'0.1.0'};reset.label='';
  const button=(id,label,role)=>({id,kind:'button',recipe:{id:`settings.button.${role}`,version:'0.1.0'},label:'',buttonLabel:label,enabled:true,event:`settings.${id}`,action:{kind:'emit'}});
  spec.sections.push({id:'actions',title:'操作',rows:[reset,button('close','关闭','secondary'),button('save','保存设置','primary')]});
  spec.actionLayouts=[{sectionId:'actions',direction:'row',align:'end',gap:12,buttonWidth:180,buttonHeight:48,shape:'default'}];
  return spec;
}
