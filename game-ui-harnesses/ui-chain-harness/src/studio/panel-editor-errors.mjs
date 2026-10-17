// Presentation only: never validates, repairs, measures or mutates a document.
// Returned strings are plain text; consumers must render them with textContent.
const typeNames={Container:'布局分组',Panel:'面板',Dialog:'弹窗',Text:'文字',Button:'按钮',Switch:'开关',CheckBox:'勾选框',RadioGroup:'单选组',Select:'下拉框',Slider:'滑块',ProgressBar:'进度条',Input:'输入框',ScrollView:'滚动区',Tabs:'页签',List:'列表',Image:'图片'};
const recipeTypes={'container':'Container','panel':'Panel','dialog':'Dialog','text':'Text','button':'Button','switch':'Switch','check-box':'CheckBox','radio-group':'RadioGroup','select':'Select','slider':'Slider','progress-bar':'ProgressBar','input':'Input','scroll-view':'ScrollView','tabs':'Tabs','list':'List','image':'Image'};
const semanticNames={body:'内容布局','settings-body':'内容布局','inventory-body':'内容布局',heading:'主标题','inventory-heading':'主标题','section-heading':'分组标题',actions:'按钮区域','inventory-grid':'仓库格位'};
const validationCode=code=>typeof code==='string'&&/^(?:panel|edit|node|skin|inventory|slice)\./.test(code);
const compact=value=>typeof value==='string'?value.replace(/\s+/gu,' ').trim():'';
const readable=value=>{const characters=[...compact(value)];return characters.length>64?characters.slice(0,64).join('')+'…':characters.join('');};
const typeOf=(node,context)=>(Array.isArray(context?.registry?.recipes)?context.registry.recipes.find(recipe=>recipe.recipeId+'@'+recipe.recipeVersion===node?.recipeRef)?.type:undefined)??recipeTypes[typeof node?.recipeRef==='string'?node.recipeRef.split('@')[0]:''];
const amount=value=>Number.isFinite(value)?String(value):null;
const number='(?:\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)';
const minimumPattern=new RegExp('^([A-Za-z]+) requires at least ('+number+')x('+number+') logical pixels for this fixture content\\.$','i');

/** A readable, stable label independent of editor DOM/selection or play state. */
export function panelEditorNodeLabel(node,document,context){
  if(!node)return '控件';
  if(node.id===document?.rootId)return '画布';
  for(const value of [node.props?.label,node.props?.title,node.props?.text])if(compact(value))return readable(value);
  if(compact(node.name)&&node.name!==node.id)return readable(node.name);
  if(semanticNames[node.id])return semanticNames[node.id];
  const type=typeOf(node,context);
  if(type==='Container'&&node.layout?.direction)return {row:'横向分组',column:'纵向分组',grid:'网格分组',wrap:'换行分组'}[node.layout.direction]??'布局分组';
  return typeNames[type]??(readable(node.id)||'控件');
}

function sourceNodes(document){
  const nodes=new Map(),duplicates=new Set();
  for(const node of Array.isArray(document?.nodes)?document.nodes:[])if(node&&typeof node.id==='string'){
    if(nodes.has(node.id))duplicates.add(node.id);else nodes.set(node.id,node);
  }
  for(const id of duplicates)nodes.delete(id);
  return nodes;
}
function nodeAtPath(path,document,nodes){
  if(typeof path!=='string')return;
  if(nodes.has(path))return path;
  // A named slot path is accepted only when that exact slot exists.
  const slash=path.indexOf('/');
  if(slash>0&&nodes.has(path.slice(0,slash))&&Object.hasOwn(nodes.get(path.slice(0,slash)).slots??{},path.slice(slash+1)))return path.slice(0,slash);
  const match=/^#?\/nodes\/(0|[1-9]\d*)(?:\/|$)/u.exec(path),node=match&&document?.nodes?.[Number(match[1])];
  return node&&nodes.get(node.id)===node?node.id:undefined;
}
function locate(error,document,nodes,message){
  // An explicit renderer node ID is authoritative. Do not retarget an error
  // from a different document by searching its prose for a familiar ID.
  if(typeof error?.nodeId==='string')return nodes.has(error.nodeId)?error.nodeId:undefined;
  const paths=[error?.path,error?.instancePath,...(Array.isArray(error?.issues)?error.issues.flatMap(issue=>[issue?.path,issue?.instancePath]):[])];
  const matches=new Set(paths.map(path=>nodeAtPath(path,document,nodes)).filter(Boolean));
  if(matches.size)return matches.size===1?[...matches][0]:undefined;
  if(!validationCode(error?.code))return;
  // Existing document/size/layout gates prefix a precise node ID, optionally
  // its slot. Never infer ownership from a skin role, type or arbitrary mention.
  const prefix=/^([A-Za-z][A-Za-z0-9_.-]{0,95}(?:\/[A-Za-z][A-Za-z0-9_.-]*)?):\s/u.exec(message);
  if(prefix)return nodeAtPath(prefix[1],document,nodes);
  if(error.code==='panel.schema'){
    const indices=new Set([...message.matchAll(/(?:^|;\s*)(\/nodes\/(?:0|[1-9]\d*)(?:\/[^;\s]*)?)/gu)].map(match=>nodeAtPath(match[1],document,nodes)).filter(Boolean));
    if(indices.size===1)return [...indices][0];
  }
}
function withoutPrefix(message,node){
  if(!node)return message;
  for(const prefix of [node.id,...Object.keys(node.slots??{}).map(slot=>node.id+'/'+slot)])if(message.startsWith(prefix+': '))return message.slice(prefix.length+2);
  return message;
}
function declaredBounds(node){
  const s=node?.sizing??{},parts=[];
  for(const [axis,name]of [['Width','宽度'],['Height','高度']]){
    const min=amount(s['min'+axis]),max=amount(s['max'+axis]);
    if(min!==null||max!==null)parts.push(name+' '+(min!==null&&max!==null?min+'–'+max:min!==null?'≥ '+min:'≤ '+max));
  }
  return parts.length?'文档声明的尺寸约束：'+parts.join('；')+' 逻辑像素。文字、皮肤和布局还可能要求更多空间。':null;
}
function skinMinimum(error,reason,document,context){
  if(error?.code!=='skin.minimum'||typeof document?.bindings?.sha256!=='string'||document.bindings.sha256!==context?.binding?.sha256)return;
  const role=/^(skin\.[A-Za-z0-9_.-]+): below declared skin minimum\.$/u.exec(reason)?.[1],evidence=context?.skinGeometry;
  if(!role||evidence?.version!=='1.0')return;
  const bindings=Array.isArray(evidence.roles)?evidence.roles.filter(binding=>binding.role===role):[],assets=bindings.length===1&&Array.isArray(evidence.assets)?evidence.assets.filter(asset=>asset.assetId===bindings[0].assetId):[];
  const minimum=assets?.length===1?assets[0].minSize:null;
  if(!minimum||![minimum.width,minimum.height].every(value=>Number.isFinite(value)&&value>0))return;
  return '该皮肤部件声明的下限：'+amount(minimum.width)+' × '+amount(minimum.height)+' 逻辑像素。九宫格、文字和布局仍可能要求更大尺寸。';
}

/**
 * Turn an existing error into {message,nodeId?,details?:string[]}.
 * document supplies identity/context only; it may be the last valid document,
 * so its dimensions are never represented as the rejected candidate or a
 * complete minimum. Unknown/ambiguous errors keep their message without a link.
 */
export function panelEditorError(error,document,context){
  const supplied=typeof error==='string'?error:typeof error?.message==='string'?error.message:'';
  const original=supplied.trim()?supplied:'画布调整未通过检查。';
  const nodes=sourceNodes(document),nodeId=locate(error,document,nodes,original),node=nodes.get(nodeId),details=[];
  let reason=withoutPrefix(original,node);
  const minimum=error?.code==='node.size'?minimumPattern.exec(reason):null;
  if(minimum&&[Number(minimum[2]),Number(minimum[3])].every(value=>Number.isFinite(value)&&value>0)){
    reason=(typeNames[minimum[1]]??minimum[1])+'的当前组件几何检查要求至少 '+amount(Number(minimum[2]))+' × '+amount(Number(minimum[3]))+' 逻辑像素。';
    details.push('这是该组件几何检查返回的下限；文字、皮肤和父级布局仍可能要求更多空间。');
  }else if(error?.code==='skin.minimum'&&/^skin\.[A-Za-z0-9_.-]+: below declared skin minimum\.$/u.test(reason))reason='尺寸低于皮肤部件声明的下限。';
  if(node){
    details.push('定位节点：'+panelEditorNodeLabel(node,document,context)+'（'+node.id+'）。');
    const bound=declaredBounds(node);if(bound)details.push(bound);
  }
  const bounds=error?.contentBounds,owner=nodes.get(bounds?.ownerId),metric=value=>Number.isFinite(value)&&value>=0;
  if(owner&&node&&bounds.nodeId===node.id&&['width','height'].every(axis=>metric(bounds.available?.[axis])&&metric(bounds.required?.[axis])&&metric(bounds.overflow?.[axis]))){
    const format=value=>String(Math.round(value*100)/100),pair=value=>format(value.width)+' × '+format(value.height);
    details.push('所属容器“'+panelEditorNodeLabel(owner,document,context)+'”（'+owner.id+'），本次可用内容区 '+pair(bounds.available)+'；内容需要 '+pair(bounds.required)+' 逻辑像素。');
    const excess=['width','height'].filter(axis=>bounds.overflow[axis]>.1).map(axis=>(axis==='width'?'宽度':'高度')+'超出 '+format(bounds.overflow[axis]));
    if(excess.length)details.push(excess.join('，')+' 逻辑像素。');
    if(metric(bounds.minimumOwner?.width)&&(bounds.allowVerticalOverflow||metric(bounds.minimumOwner?.height)))details.push('容纳该内容的容器至少需要宽 '+format(bounds.minimumOwner.width)+(bounds.allowVerticalOverflow?'':'、高 '+format(bounds.minimumOwner.height))+' 逻辑像素（包含当前边距与保留区域；其他内容仍可能要求更大空间）。');
  }
  const layout=error?.layoutBounds,layoutOwner=nodes.get(layout?.ownerId);
  const validRect=rect=>rect&&['x','y','width','height'].every(key=>Number.isFinite(rect[key]))&&rect.width>=0&&rect.height>=0;
  const layoutEvidence=validationCode(error?.code)&&node&&layoutOwner&&layout.nodeId===node.id&&['yoga','fixed-flow','fixed-child','free-child'].includes(layout.source)&&validRect(layout.available)&&validRect(layout.occupied)&&['left','top','right','bottom'].every(side=>metric(layout.overflow?.[side]));
  if(layoutEvidence){
    const format=value=>String(Math.round(value*1000)/1000),pair=rect=>format(rect.width)+' × '+format(rect.height);
    const excessAmount=value=>value>0&&value<.001?'少于 0.001':format(value);
    const occupiedLabel=layout.source==='fixed-child'?'当前控件尺寸 ':layout.source==='fixed-flow'?'当前排版占用 ':'该子项占用 ';
    details.push('本次容器“'+panelEditorNodeLabel(layoutOwner,document,context)+'”（'+layoutOwner.id+'）可用内容区 '+pair(layout.available)+'；'+occupiedLabel+pair(layout.occupied)+' 逻辑像素。');
    if(['yoga','free-child'].includes(layout.source))details.push('内容起点（'+format(layout.occupied.x)+'，'+format(layout.occupied.y)+'），可用区域起点（'+format(layout.available.x)+'，'+format(layout.available.y)+'）；坐标相对于所属容器。');
    const excess=Object.entries(layout.source==='fixed-child'?{right:'宽度',bottom:'高度'}:{left:'左边',top:'上边',right:'右边',bottom:'下边'}).filter(([side])=>layout.overflow[side]>0).map(([side,name])=>name+'超出 '+excessAmount(layout.overflow[side]));
    if(excess.length)details.push(excess.join('，')+' 逻辑像素。');
    details.push('以上是本次失败排版的实际占用，不代表容器的完整最小尺寸。');
  }
  const skin=skinMinimum(error,withoutPrefix(original,node),document,context);if(skin)details.push(skin);
  const ownerId=owner&&node&&bounds.nodeId===node.id?owner.id:layoutEvidence&&layoutOwner.id!==node.id?layoutOwner.id:undefined;
  return {message:node?'“'+panelEditorNodeLabel(node,document,context)+'”：'+reason:reason,...(nodeId?{nodeId}:{}),...(ownerId?{ownerId}:{}),...(details.length?{details}:{})};
}
