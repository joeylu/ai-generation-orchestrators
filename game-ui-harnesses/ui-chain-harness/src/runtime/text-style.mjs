// Shared node-local typography policy. No fonts, colors from remote resources,
// renderer objects, descendant inheritance, or authoring mutations live here.
export const fontSizeLimits=Object.freeze({min:12,max:96});
export const textStylePropsSchema=Object.freeze({fontSize:Object.freeze({type:'integer',minimum:12,maximum:96}),textColor:Object.freeze({type:'string',pattern:'^#[0-9A-Fa-f]{6}$'})});
const types=new Set(['Text','Panel','Dialog','Button','Switch','CheckBox','RadioGroup','Select','Tabs','List','Input','Slider','ProgressBar']);
export const supportsTextStyle=type=>types.has(type);
export const supportsFontSize=supportsTextStyle;
// Authoring only exposes a node's own drawn text. Custom List rows belong to
// their child controls; disabled numeric captions have nothing to recolor.
export const supportsNodeTextStyle=(type,node)=>supportsTextStyle(type)&&!(type==='List'&&(node.slots?.items??[]).length)&&!(['Slider','ProgressBar'].includes(type)&&node.props?.showValue===false);
export const isTextColor=value=>typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const baseProfile=Symbol('ui-chain.text-style-base');
const baseOf=profile=>profile[baseProfile]??profile;

export function upgradeTextStyleRegistry(registry){
  if(!Array.isArray(registry?.recipes))fail('text.registry','缺少可派生的组件配方合同。');
  const next=structuredClone(registry);
  const canonical=value=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)))):null;
  for(const recipe of next.recipes)if(supportsTextStyle(recipe.type))for(const [key,schema]of Object.entries(textStylePropsSchema)){
    if(!recipe.propsSchema?.properties||typeof recipe.propsSchema.properties!=='object')fail('text.registry',`${recipe.recipeId}: 缺少可派生的属性合同。`);
    const existing=recipe.propsSchema.properties[key];
    if(existing!==undefined&&canonical(existing)!==canonical(schema))fail('text.registry',`${recipe.recipeId}: 已有文字样式声明与本地编辑能力不兼容。`);
    if(existing===undefined)recipe.propsSchema.properties[key]=structuredClone(schema);
  }
  return next;
}

export function assertTextStyle(props={}){
  if(props.fontSize!==undefined&&(!Number.isInteger(props.fontSize)||props.fontSize<fontSizeLimits.min||props.fontSize>fontSizeLimits.max))fail('edit.font-size','字号须为 12–96 之间的整数逻辑像素。');
  if(props.textColor!==undefined&&!isTextColor(props.textColor))fail('edit.text-color','文字颜色须为 #RRGGBB 格式的十六进制颜色。');
}

export function textMetrics(profile,props={}){
  assertTextStyle(props);
  profile=baseOf(profile);
  const base=profile.fontSize,line=profile.geometry.lineHeight,item=profile.itemHeight;
  if(![base,line,item].every(value=>Number.isFinite(value)&&value>0))fail('text.profile','皮肤字体度量无效。');
  if(props.fontSize===undefined)return {fontSize:base,lineHeight:line,itemHeight:item};
  const fontSize=props.fontSize,lineHeight=Math.ceil(line*fontSize/base);
  return {fontSize,lineHeight,itemHeight:Math.max(item,lineHeight+Math.max(0,item-line))};
}

// Preserve the original metrics exactly when omitted. Larger text reserves the
// original per-row leading around its scaled line; smaller text keeps row height.
export function textProfile(profile,props={}){
  profile=baseOf(profile);
  const metrics=textMetrics(profile,props);
  if(props.fontSize===undefined&&props.textColor===undefined)return profile;
  const next={...profile,fontSize:metrics.fontSize,itemHeight:metrics.itemHeight,geometry:{...profile.geometry,lineHeight:metrics.lineHeight},...(props.textColor!==undefined?{palette:{...profile.palette,text:props.textColor}}:{})};
  Object.defineProperty(next,baseProfile,{value:profile});
  return next;
}

// A versioned heading supplies a presentation default. An explicit author font
// remains the strongest setting, and unmarked nodes retain the old policy.
export function surfaceTextMetrics(profile,props={},surfaceFontSize){
  if(surfaceFontSize===undefined)return textMetrics(profile,props);
  assertTextStyle(props);
  if(!Number.isInteger(surfaceFontSize)||surfaceFontSize<8||surfaceFontSize>96)fail('skin.surface-style','Reference heading font size must be an integer from 8 to 96.');
  if(props.fontSize!==undefined)return textMetrics(profile,props);
  const base=textMetrics(profile),lineHeight=Math.ceil(base.lineHeight*surfaceFontSize/base.fontSize);
  return {fontSize:surfaceFontSize,lineHeight,itemHeight:Math.max(base.itemHeight,lineHeight+Math.max(0,base.itemHeight-base.lineHeight))};
}

export function surfaceTextProfile(profile,props={},surfaceFontSize){
  if(surfaceFontSize===undefined)return textProfile(profile,props);
  const metrics=surfaceTextMetrics(profile,props,surfaceFontSize);
  if(props.fontSize!==undefined)return textProfile(profile,props);
  profile=baseOf(profile);
  const next={...profile,fontSize:metrics.fontSize,itemHeight:metrics.itemHeight,geometry:{...profile.geometry,lineHeight:metrics.lineHeight},...(props.textColor!==undefined?{palette:{...profile.palette,text:props.textColor}}:{})};
  Object.defineProperty(next,baseProfile,{value:profile});
  return next;
}
