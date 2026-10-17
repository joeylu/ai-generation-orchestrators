// Shared authoring contract and Yoga calculation. No display transforms or UI state.
// The runtime supplies Pixi Layout's Yoga instance; offline validation supplies Yoga.
import Ajv from 'ajv';
import schema from '../../schemas/panel-document.schema.json' with {type:'json'};
const ajv=new Ajv({strict:true}), sizingSchema=ajv.compile(schema.definitions.sizing), layoutSchema=ajv.compile(schema.definitions.layout);
export const hasLayoutRules = n => Object.keys(n.sizing ?? {}).length > 0 ||
  ['justify', 'columns', 'cellWidth', 'cellHeight'].some(k => n.layout?.[k] !== undefined) || n.layout?.direction === 'grid';
const error = (n, message, code='panel.layout') => { throw Object.assign(new Error(`${n.id}: ${message}`), {code}); };
const axisName = axis => axis === 'width' ? 'Width' : 'Height';

// Rejected-candidate evidence only. Neither these rectangles nor their excess
// predict a complete minimum: reflow and other children may need more space.
// Yoga/free-child retain computed/authored positions. Fixed-flow/fixed-child
// use padding-anchored size-check envelopes, not measured child positions.
export function layoutBoundsError({nodeId,ownerId,available,occupied,source,message,code='panel.overflow'}) {
  const failure=Object.assign(new Error(`${nodeId}: ${message}`),{code,nodeId,ownerId});
  const valid=rect=>rect&&['x','y','width','height'].every(key=>Number.isFinite(rect[key]))&&rect.width>=0&&rect.height>=0;
  if(valid(available)&&valid(occupied))failure.layoutBounds={nodeId,ownerId,source,available:{...available},occupied:{...occupied},overflow:{
    left:Math.max(0,available.x-occupied.x),top:Math.max(0,available.y-occupied.y),
    right:Math.max(0,occupied.x+occupied.width-available.x-available.width),
    bottom:Math.max(0,occupied.y+occupied.height-available.y-available.height),
  }};
  return failure;
}

export function checkLayoutRules(n, parent) {
  const s = n.sizing ?? {}, l = n.layout ?? {};
  if(!sizingSchema(s)||!layoutSchema(l))error(n,'无效布局字段或尺寸约束。');
  if(n.type!=='Container'&&Object.keys(l).length)error(n,'子项排版只设置在 Container 上。');
  if(l.direction!=='grid'&&['columns','cellWidth','cellHeight'].some(k=>l[k]!==undefined))error(n,'网格参数仅适用于固定网格。');
  if(parent?.sizing?.[(parent.layout?.direction==='row'?'width':'height')+'Mode']==='content'&&(s.grow||s.shrink))error(n,'自适应主轴不能依赖子项扩展或收缩。');
  for (const axis of ['width','height']) {
    const suffix = axisName(axis), mode = s[axis+'Mode'] ?? 'fixed';
    if (!['fixed','fill','content'].includes(mode)) error(n, '未知尺寸模式。');
    const min = Math.max(24,n.minimum?.[axis] ?? 24,s['min'+suffix] ?? 24);
    const max = s['max'+suffix] ?? 16384;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) error(n,'最小尺寸超过最大尺寸或组件安全尺寸。');
    if (mode === 'content' && (n.type !== 'Container' || l.childrenMode === 'free')) error(n,'内容自适应仅用于流式 Container。');
    if (mode === 'fill' && (!parent || parent.layout?.childrenMode === 'free')) error(n,'填充尺寸必须位于流式 Container 中。');
    if (parent && mode === 'fill' && parent.sizing?.[axis+'Mode'] === 'content') error(n,'内容自适应父级不能依赖同轴填充子项。');
  }
  if ((s.grow || s.shrink || s.alignSelf) && (!parent || parent.layout?.childrenMode === 'free')) error(n,'弹性和单项对齐必须位于流式 Container 中。');
  if (l.direction === 'wrap' && s.widthMode === 'content') error(n,'自动换行需要明确或填充宽度。');
  if (l.direction === 'grid') {
    if (l.childrenMode === 'free' || !Number.isInteger(l.columns) || l.columns < 1 || l.columns > 16 || !Number.isFinite(l.cellHeight) || l.cellHeight < 24) error(n,'网格需要 1–16 列及有效格子高度。');
    if (!l.cellWidth && s.widthMode === 'content') error(n,'等宽网格需要明确宽度；内容宽度模式须指定格子宽度。');
    if (s.heightMode === 'content' && l.justify && l.justify !== 'flex-start') error(n,'自适应高度网格不分配额外纵向空间。');
  }
}

export function layoutTreeHasRules(n) {
  return hasLayoutRules(n) || (n.children ?? []).some(layoutTreeHasRules);
}

// Solves one connected Container tree. Non-Container slots remain owned by their
// control adapter, so changing a Panel's content contract cannot silently change it.
export function solveLayout(Yoga, tree) {
  const allocated = [], entries = [], config = Yoga.Config.create();
  config.setPointScaleFactor(0); // Preserve logical fractions at every device DPR.
  const create = () => { const y = Yoga.Node.createWithConfig(config); allocated.push(y); return y; };
  const align = { 'flex-start':Yoga.ALIGN_FLEX_START, center:Yoga.ALIGN_CENTER, 'flex-end':Yoga.ALIGN_FLEX_END, stretch:Yoga.ALIGN_STRETCH };
  const justify = { 'flex-start':Yoga.JUSTIFY_FLEX_START, center:Yoga.JUSTIFY_CENTER, 'flex-end':Yoga.JUSTIFY_FLEX_END,
    'space-between':Yoga.JUSTIFY_SPACE_BETWEEN, 'space-around':Yoga.JUSTIFY_SPACE_AROUND, 'space-evenly':Yoga.JUSTIFY_SPACE_EVENLY };
  function build(n,parent,cell) {
    checkLayoutRules(n,parent);
    const y=create(), s=n.sizing ?? {}, l=n.layout ?? {}, row=parent?.layout?.direction==='row';
    entries.push({n,y,parent,cell});
    y.setFlexShrink(s.shrink ?? 0); y.setFlexGrow(s.grow ?? 0);
    if(s.alignSelf) y.setAlignSelf(align[s.alignSelf]);
    for(const axis of ['width','height']) {
      const suffix=axisName(axis), mode=s[axis+'Mode'] ?? 'fixed';
      y['setMin'+suffix](Math.max(24,n.minimum?.[axis] ?? 24,s['min'+suffix] ?? 24));
      y['setMax'+suffix](s['max'+suffix] ?? 16384);
      if(cell) {
        if(mode==='content'||s.grow||s.shrink)error(n,'固定网格中的子项使用统一格子尺寸，不接受内容尺寸或弹性权重。');
        if(axis==='width' && cell.width===undefined)y.setWidthPercent(100);
        else y['set'+suffix](cell[axis]);
      } else if(mode==='fixed') y['set'+suffix](n.size[axis]);
      else if(mode==='fill') {
        if((axis==='width')===row) { y.setFlexBasis(0); y.setFlexGrow(s.grow ?? 1); }
        else { y['set'+suffix+'Percent'](100); }
      }
    }
    if(n.visible===false){y.setDisplay(Yoga.DISPLAY_NONE);return y;}
    if(parent?.layout?.childrenMode==='free') {
      y.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
      if(!n.position)error(n,'自由区域子项缺少坐标。');
      y.setPosition(Yoga.EDGE_LEFT,n.position.x);y.setPosition(Yoga.EDGE_TOP,n.position.y);
    } else if(parent && n.position) error(n,'流式布局不接受手动坐标。');
    if(n.type==='Container') {
      y.setPadding(Yoga.EDGE_ALL,l.padding ?? 0);
      y.setGap(Yoga.GUTTER_ALL,l.gap ?? 8);
      y.setAlignItems(align[l.align ?? 'flex-start']);
      y.setJustifyContent(justify[l.justify ?? 'flex-start']);
      y.setFlexDirection(['row','wrap'].includes(l.direction)?Yoga.FLEX_DIRECTION_ROW:Yoga.FLEX_DIRECTION_COLUMN);
      y.setFlexWrap(l.direction==='wrap'?Yoga.WRAP_WRAP:Yoga.WRAP_NO_WRAP);
      if(l.direction==='grid') {
        const children=(n.children ?? []).filter(c=>c.visible!==false);
        for(let i=0;i<children.length;i+=l.columns) {
          const line=create();line.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);line.setFlexShrink(0);line.setHeight(l.cellHeight);
          line.setGap(Yoga.GUTTER_COLUMN,l.gap ?? 8);line.setAlignSelf(Yoga.ALIGN_STRETCH);
          line.setJustifyContent(justify[l.justify ?? 'flex-start']);
          for(const child of children.slice(i,i+l.columns)) {
            const slot=create();slot.setHeight(l.cellHeight);slot.setFlexShrink(0);
            if(l.cellWidth)slot.setWidth(l.cellWidth);
            else {slot.setFlexBasis(0);slot.setFlexGrow(1);}
            const item=build(child,n,{width:l.cellWidth,height:l.cellHeight,slot,line});slot.insertChild(item,0);line.insertChild(slot,line.getChildCount());
          }
          // Empty trailing slots keep the last row aligned with preceding rows.
          if(!l.cellWidth)for(let j=line.getChildCount();j<l.columns;j++){const slot=create();slot.setFlexBasis(0);slot.setFlexGrow(1);line.insertChild(slot,line.getChildCount());}
          y.insertChild(line,y.getChildCount());
        }
      } else for(const child of n.children ?? []) y.insertChild(build(child,n),y.getChildCount());
    }
    return y;
  }
  try {
    const root=build(tree,null);root.calculateLayout(undefined,undefined,Yoga.DIRECTION_LTR);
    const result=new Map();
    for(const {n,y,parent,cell} of entries) {
      if(n.visible===false)continue;
      const r=y.getComputedLayout();
      if(cell){const a=cell.slot.getComputedLayout(),b=cell.line.getComputedLayout();r.left+=a.left+b.left;r.top+=a.top+b.top;
        if(Math.abs(r.width-a.width)>.05||Math.abs(r.height-a.height)>.05)error(n,'格子尺寸不满足组件最小/最大尺寸。');}
      result.set(n.id,{width:r.width,height:r.height,x:r.left,y:r.top});
      if(parent){const p=entries.find(e=>e.n===parent).y.getComputedLayout(),pad=parent.layout?.padding ?? 0;
        if(r.left<pad-.05||r.top<pad-.05||r.left+r.width>p.width-pad+.05||r.top+r.height>p.height-pad+.05)
          throw layoutBoundsError({nodeId:n.id,ownerId:parent.id,source:'yoga',available:{x:pad,y:pad,width:p.width-pad*2,height:p.height-pad*2},occupied:{x:r.left,y:r.top,width:r.width,height:r.height},message:'排版超出容器，无法在最小尺寸约束内放下内容。请扩大容器或使用滚动区域。'});}
    }
    return result;
  } finally { for(const y of allocated.reverse())y.free();config.free(); }
}
