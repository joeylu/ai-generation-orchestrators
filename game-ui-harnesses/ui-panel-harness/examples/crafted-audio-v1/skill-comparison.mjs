import {snapshotJson} from '../../src/spec.mjs';
import {BUTTON_STYLE_KEYS} from '../../src/button-style.mjs';
import {TITLE_BAR_KEYS} from '../../src/title-bar.mjs';
import {createPanelBundle,panelBundleAssetInputs} from '../../src/panel-bundle.mjs';

export const ART_SKILL_CONDITIONS=Object.freeze([
  {id:'frontend-design',label:'Anthropic frontend-design',files:['frontend-design.SKILL.md']},
  {id:'taste-redesign',label:'Taste · redesign-existing-projects',files:['taste-redesign.SKILL.md']},
  {id:'impeccable',label:'Impeccable · Operate',files:['impeccable.SKILL.md','impeccable.operate.md','impeccable.layout.md','impeccable.typeset.md','impeccable.craft-floor.md']},
]);
export const ART_SKILL_BRIEF='优化现有声音设置面板的美术效果。目标是精致、克制、清楚、耐看的现代简约游戏UI，保持薄荷绿为唯一强调色，分别提供浅色和深色。保留全部现有文案、控件、素材、事件、动作、字段、范围、默认值、试玩值及行顺序。可以在既有能力内自由决定配色、字号层级、圆角、内边距、纵向节奏、标题对齐、按钮主次和两分区布局。不增加装饰文案、图片、图标、纹理、功能或营销元素，不安装或下载字体/库，不生成媒体。不要为了体现某个Skill而刻意变形；以该Skill指导下最好的任务界面为目标。';
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const choice=values=>({enum:values});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const color={type:'string',pattern:'^#[0-9A-Fa-f]{6}$'};
const exact=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw new Error('ART_STUDY_RESPONSE_FIELDS');
};

/** Narrow evaluation envelope; the public PanelSpec/compiler remains unchanged. */
export function artSkillResponseSchema(baseline) {
  const sample=baseline.spec,theme=baseline.catalog.themes.find(t=>t.id===sample.theme.id&&t.version===sample.theme.version);
  const tokens=object(Object.fromEntries(Object.keys(theme.tokens).map(key=>[key,
    ['background','surface','control','accent','text','muted','border'].includes(key)?color:
    key==='fontFamily'?choice([theme.tokens.fontFamily]):
    key==='fontSize'?integer(16,20):key==='headingSize'?integer(14,18):key==='titleSize'?integer(20,32):
    key==='radius'?integer(8,20):integer(8,32)])));
  const body=object({id:choice([sample.layout.body.id]),kind:choice(['column','row']),width:choice(['fill']),gap:integer(0,40),align:choice(['start','center','end']),
    children:{type:'array',minItems:2,maxItems:2,items:choice(sample.layout.body.children)}});
  const layout=object({width:integer(380,836),padding:integer(24,48),gap:integer(12,40),sectionGap:integer(0,40),labelWidth:integer(80,200),rowHeight:integer(56,96),
    titleHeight:integer(28,56),sectionTitleHeight:integer(24,36),maxHeight:integer(400,760),overflow:choice(['error']),body});
  const titleBar=nullable(object(Object.fromEntries(TITLE_BAR_KEYS.map(key=>[key,
    key==='horizontalAlign'?nullable(choice(['left','center','right'])):key==='verticalAlign'?nullable(choice(['top','middle','bottom'])):
    ['backgroundColor','textColor'].includes(key)?nullable(color):key==='padding'?integer(0,8):nullable(integer(key==='fontSize'?20:0,key==='fontSize'?32:16))]))));
  const buttonStyle=object(Object.fromEntries(BUTTON_STYLE_KEYS.map(key=>[key,
    key.endsWith('Color')?nullable(color):key==='shape'?nullable(choice(['default','circle'])):
    nullable(integer(key==='width'||key==='height'?44:0,key==='width'?512:key==='height'?64:key==='borderWidth'?2:16))])));
  const buttonStyles={type:'array',minItems:0,maxItems:3,items:object({rowId:choice(['reset-row','close','save']),style:buttonStyle})};
  const actionLayouts={type:'array',minItems:0,maxItems:1,items:object({sectionId:choice(['actions']),direction:choice(['row','column']),align:choice(['start','center','end']),
    gap:integer(0,24),buttonWidth:integer(104,400),buttonHeight:integer(44,64),shape:choice(['default'])})};
  const visual=object({tokens,canvas:object({width:integer(440,900),height:integer(400,760)}),layout,titleBar,buttonStyles,actionLayouts});
  return object({artStudyVersion:choice(['0.1']),designNote:{type:'string',minLength:1,maxLength:1000},light:visual,dark:visual});
}

/** Program owns immutable business rows/assets. No repair, clamping or fallback on model output. */
export async function materializeArtSkillResponse(input,baselines,core,{conditionId,fixture=false}={}) {
  if(!ART_SKILL_CONDITIONS.some(condition=>condition.id===conditionId))throw new Error('ART_STUDY_CONDITION');
  const response=snapshotJson(input);exact(response,['artStudyVersion','designNote','light','dark']);
  if(response.artStudyVersion!=='0.1'||typeof response.designNote!=='string'||!response.designNote.trim()||response.designNote.length>1000)throw new Error('ART_STUDY_RESPONSE');
  const bundles={};
  for(const mode of ['light','dark']){
    const before=baselines[mode];
    if(before.spec.id!=='usage-settings'||before.spec.provenance.kind!=='programmatic-fixture'||before.catalog.id!=='crafted-audio-study'||before.compilerVersion!=='0.20.0')throw new Error('ART_STUDY_BASELINE');
    const visual=response[mode];exact(visual,['tokens','canvas','layout','titleBar','buttonStyles','actionLayouts']);
    const spec=structuredClone(before.spec),catalog=structuredClone(before.catalog);
    const originalTheme=catalog.themes.find(t=>t.id===spec.theme.id&&t.version===spec.theme.version);
    if(visual.tokens.fontFamily!==originalTheme.tokens.fontFamily)throw new Error('ART_STUDY_FONT');
    const permitted=new Set(before.spec.sections.map(s=>s.id));
    if(visual.layout?.body?.children?.some(child=>child.kind!=='section'||!permitted.has(child.sectionId)))throw new Error('ART_STUDY_GROUPS');
    catalog.id=`skill-art-${conditionId}`;catalog.version='0.1.0';
    catalog.themes=catalog.themes.filter(t=>t.id===spec.theme.id).map(t=>({...t,version:'0.11.0',tokens:visual.tokens}));
    spec.theme={id:spec.theme.id,version:'0.11.0'};
    spec.panelSpecVersion='0.12';spec.buttonFonts=[];
    for(const key of ['canvas','layout','titleBar','buttonStyles','actionLayouts'])spec[key]=visual[key];
    spec.provenance={kind:fixture?'programmatic-fixture':'agent-authored',description:fixture?'Local response-contract simulation; no model call.':`Single isolated art study guided by ${conditionId}; original business supplied by program.`,assumptions:[]};
    bundles[mode]=await createPanelBundle(spec,catalog,core,before.state,panelBundleAssetInputs(before,core));
    for(const key of ['state','bindings','actions','assetClosure'])if(JSON.stringify(bundles[mode][key])!==JSON.stringify(before[key]))throw new Error('ART_STUDY_BUSINESS_DRIFT');
  }
  return bundles;
}
