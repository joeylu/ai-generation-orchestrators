import { createCanvas } from './canvas.mjs';
import { applyTerrainEditPatch, terrainEditResponse } from './terrain-edit-wire.mjs';
import { selectionBox } from './geometry.mjs';
import { curvePreset, mixedPreset } from './curve-tools.mjs';
import { insertCurvePoint } from './curve-insertion.mjs';
import {terrainRegions,regionForTarget,terrainMoveBlock} from '../terrain-move.mjs';
import {curveEndpoint} from '../curve-join.mjs';
import {findCurveJoinWithBaseSnap} from './terrain-base-snap.mjs';
import { findGridConnection,gridConnectionTargets } from '../mixed-terrain.mjs';
import {arrangeWorkbench,icon,button,friendlyAsset} from './workbench-ui.mjs';
import {environmentLibraryRoleLabel,environmentPlacement,groupSceneLayers,sceneGroupTree,layerGroupLeaves,reorderableLayers} from './layer-groups.mjs';
import {environmentLibraryRoles} from '../environment-library-roles.mjs';
import {createLayerReorder} from './layer-reorder-ui.mjs';
import {isGeneratedEnvironment} from './generated-environment-id.mjs';
import {paletteAssetRoles} from './palette-groups.mjs';
import {planTerrainStroke} from './terrain-stroke.mjs';
import {presetThumbnail} from './preset-thumbnail.mjs';
import {bindPaletteDrag} from './palette-drag.mjs';
import {presetPlacement,placementLayer} from './preset-placement.mjs';
import {findBrush,brushTool,brushStroke} from './brushes.mjs';
import {mountProjectUI} from './project-ui.mjs';
import {mountAppearancePanel} from './appearance-panel.mjs';
import {supportsInstanceAppearance} from '../instance-appearance.mjs';
import {mountEnvironmentLibrary} from './environment-library-ui.mjs';
import { mountEnvironmentAnimation } from './environment-animation-ui.mjs';
import { supportsEnvironmentAnimation } from '../environment-animation.mjs';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const UI=arrangeWorkbench(),locked=new Set(),hiddenObjects=new Set(),folded=new Set(['group:empty']);let activeLayer='',paletteDrag=null;
const paletteFolded=new Set();
let layerGroups=[], freshAsset='';
let selectedBrushId='',brushPreviewKey='',savePending=false,saveProblem='',appearancePanel,openEnvironmentLibrary,openEnvironmentAnimation;
let state, metadata, canvas, category = 'terrain', tool = 'select', chosen = '', selected = '', preview = false, busy = false,
  hidden = new Set(), savedHash, camera, terrainAppearance = 'fixture', selectedCurve = '', selectedCurvePoint = 0, gridTargets=[],terrainSelection=null;
const errorMessages = {
  INSTANCE_OUT_OF_BOUNDS:'这类素材绑定地图地形，请放在地图内；普通场景素材可自由放到框外。',
  TERRAIN_SKIN_CELLS: '完整平台外观需要保留原有格子；请选中平台并点击“转为可刷地形”，再修改地形。',
  TERRAIN_SKIN_ISOLATION: '完整平台外观暂不支持接入其他地形；请选中平台并点击“转为可刷地形”，再延长。',
  TERRAIN_SKIN_CONVERSION_TARGET:'请选中一张完整平台外观或仅含一张平台外观的组合；其他对象保持原样。',
  TERRAIN_SKIN_ANCHOR: '平台贴图须落在格点、使用 1 倍视差图层；请通过悬浮台组合放置。',
  ASSEMBLY_CELL_LOCKED: '组合中的地形尚未展开，请先选择组合并点击“展开组合”。',
  TERRAIN_OVERLAP: '与已有地形重叠，整次操作已取消。',
  TERRAIN_OUT_OF_BOUNDS: '地形超出地图范围，请先扩建。',
  ASSEMBLY_OUT_OF_BOUNDS: '组合超出地图范围，请调整位置或先扩建。',
  STALE_REVISION: '另一个窗口已更新地图。可通过「下载 → 地图 JSON」保留当前画面对应的副本，刷新后继续编辑。',
  CURVE_POINT_ORDER: '控制点必须从左到右排列，相邻至少间隔 32 单位；本次修改已取消。',
  CURVE_GRID_OVERLAP: '这里的格子地形与曲线实体重叠，请放到坡面上方或其他空位。',
  CURVE_SOLID_OVERLAP: '两块曲线地形实体重叠，请调整位置或封底高度。',
  CURVE_DOMAIN: '曲线长度或范围不符合要求，每条最长 4096 单位。',
  CURVE_DEPTH: '曲线或切线离封底太近、或超出顶部范围；本次修改已取消。',
  CURVE_CAP_FOLD: '弯折过急，草沿会折叠；请放缓切线或拉开控制点。',
  CURVE_OUT_OF_BOUNDS: '曲线超出地图范围；本次修改已取消。',
  CURVE_ENDPOINT_TANGENT: '首版的两个端点须保持水平切线。',
  CURVE_JOIN_BASE: '两条曲线封底高度不同，请先统一封底 Y；本次合并已取消。',
  CURVE_JOIN_MATERIAL: '两条曲线的材质家族或轮廓类型不同，不能直接合并。',
  CURVE_JOIN_DISTANCE: '端点距离过远，请将端点拖近后再合并。',
  CURVE_JOIN_POINT_LIMIT: '合并后超过 32 个控制点，请先简化曲线。',
  CURVE_JOIN_SPAN: '合并后超过单条 4096 单位长度；本次合并已取消。',
  CURVE_JOIN_TARGET: '附近没有可连接的另一条曲线端点。',
  GRID_CONNECTION_BASE:'格子平台与曲线的封底 Y 须相同，本次连接已取消。',
  GRID_CONNECTION_RECTANGLE:'已连接的格子区域须保持完整矩形；请先解除连接再改变形状。',
  GRID_CONNECTION_ANCHOR:'此端点已固定到格子平台，先解除连接再移动。',
  GRID_CONNECTION_LOCKED:'此端点已连接格子平台，先解除连接再修改接头。',
  GRID_CONNECTION_SPAN:'连接后的连续区域超过 8192 单位，本次连接已取消。',
  TERRAIN_MOVE_TARGET:'这块地形已变化，请重新选择后移动。',
  TERRAIN_MOVE_GRID:'含格子的地形须按整格移动。',
  TERRAIN_MOVE_OFFSET:'本次地形移动距离无效或过大。',
  LAYER_ORDER_GROUP:'只能在同一组内调整独立图层的顺序。',
  OBJECT_ORDER_LAYER:'只能在同一图层分组内调整对象顺序。',
  GRID_CONNECTION_DISTANCE:'格子接头距离过远，请先将端点移近。',
};
function status(message, error = false, notice = false) { $('status').textContent = message; $('status').dataset.error = String(error); $('status').dataset.notice = String(notice); }
function clearNumericError(input) {
  input.removeAttribute('aria-invalid');
  const error = $(input.getAttribute('aria-errormessage'));
  if (error) error.hidden = true;
}
function setNumericValue(id, value) {
  const input = $(id);
  input.value = value ?? '';
  clearNumericError(input);
}
function numericValues(...ids) {
  const values = [];
  for (const id of ids) {
    const input = $(id), value = input.valueAsNumber;
    const { rangeUnderflow, rangeOverflow } = input.validity;
    const integer = input.step === '1';
    if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || rangeUnderflow || rangeOverflow) {
      const error = $(input.getAttribute('aria-errormessage'));
      error.textContent = integer ? '请输入整数。' : '请输入 -2 到 2 之间的数值。';
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return null;
    }
    values.push(value);
  }
  return values;
}
function controls() {
  const gameFrame = $('game-frame').checked;
  for (const id of ['zoom-in', 'zoom-out', 'fit']) $(id).disabled = preview && gameFrame;
  document.querySelectorAll('[data-tool]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.tool === tool)); button.disabled = preview || busy; });
  $('preview').setAttribute('aria-pressed', String(preview)); $('preview').textContent = preview ? '退出 Play Mode' : 'Play Mode';
  $('preview').title=preview?'返回编辑，恢复原来的镜头':'按游戏视口查看实际画面';
  $('preview-camera').setAttribute('aria-pressed',String(preview&&!gameFrame));$('preview-camera').disabled=busy||!preview;
  const singleFrame=!!state.scene&&state.scene.worldBounds.width<=state.scene.defaultCamera.viewport.width&&state.scene.worldBounds.height<=state.scene.defaultCamera.viewport.height;
  $('preview-camera').title=!gameFrame?'自由镜头已开启：拖动平移、滚轮缩放；再次点击回到游戏视口'
    :singleFrame?'当前地图只有一屏；开启自由镜头后可拖动和缩放':'开启自由镜头：解除游戏视口约束，拖动平移、滚轮缩放';
  document.body.dataset.preview = String(preview);
  document.body.dataset.activeTool=tool;
  const saveState=$('save-state');
  if(state.workspace||saveProblem){
    const message=savePending?'正在保存到本机…':saveProblem==='stale'?'版本已变化':saveProblem?'保存结果待核对':'已保存到本机';
    if(saveState.textContent!==message)saveState.textContent=message;
  }
  saveState.dataset.error=String(!!saveProblem);
  $('mode-label').textContent = preview ? gameFrame ? '游戏视口 · 视差开启 · ← → 移动镜头' : '纯预览 · 视差开启' : `编辑模式 · ${ { select: '选择', paint: '画刷', erase: '擦除', curve: '曲线控制点', pan: '平移', 'place-module': '放置环境块', 'place-preset': '放置组合', 'place-curve':'放置曲线' }[tool] }`;
  const placement = !preview&&tool.startsWith('place-') ? placementTarget({kind:tool.slice(6),id:chosen}) : null;
  $('placement-hint').textContent = placement?.message ?? '按当前工具在指定格操作。';
  $('placement-target').hidden=!placement;
  if(placement){$('placement-target').textContent=placement.message;$('placement-target').dataset.error=String(placement.blocked);}
  for(const row of $('layers').querySelectorAll('[data-source-layer]'))
    row.dataset.placementActive=String(row.dataset.sourceLayer===activeLayer);
  for(const handle of $('layers').querySelectorAll('[data-reorder-layer]'))
    handle.disabled=busy||preview||locked.has(handle.dataset.reorderLayer);
  for(const handle of $('layers').querySelectorAll('[data-reorder-object]'))
    handle.disabled=busy||preview||locked.has(handle.dataset.reorderObject)||locked.has(handle.closest('[data-source-layer]').dataset.sourceLayer);
  for (const id of ['apply-cell', 'extend', 'move', 'duplicate', 'delete', 'expand']) {
    if (preview || busy) $(id).disabled = true;
  }
  $('undo').disabled = preview || busy || !state.history.undoDepth;
  $('redo').disabled = preview || busy || !state.history.redoDepth;
  $('open').disabled = busy; $('save').disabled = busy; $('preview').disabled = busy;
  $('export-pack').disabled = busy;
  $('terrain-appearance').disabled = busy || !metadata.terrainPreview;
  for(const card of $('palette').querySelectorAll('button[data-asset-kind]')){card.disabled=preview||busy;card.title=preview?'退出 Play Mode 后可拖入素材':card.dataset.dragTitle??'';card.setAttribute('aria-pressed',String(paletteSelected(card.dataset.assetKind,card.dataset.assetId)));}
  for(const rename of $('palette').querySelectorAll('.asset-rename'))rename.disabled=preview||busy;
  for(const generate of $('palette').querySelectorAll('[data-environment-generate]'))generate.disabled=preview||busy;
  updateCurveFields();
  const owner=state.document.instances.find(i=>i.instanceId===selected)??state.document.assemblyInstances.find(i=>i.instanceId===selected);
  const direct=state.document.instances.find(i=>i.instanceId===selected),module=metadata.modules.find(m=>m.assetId===direct?.assetId);
  const frozen=owner&&(locked.has(owner.layerId)||locked.has(selected));
  $('move').disabled=busy||preview||frozen||!direct;
  const scalable=direct&&!frozen&&module?.kind!=='strip'&&!module?.terrainSkin;
  for (const [id, available] of Object.entries({ duplicate: owner&&!frozen, delete: owner&&!frozen,
    expand: owner&&!direct&&!frozen, 'scale-up': scalable, 'scale-down': scalable, 'scale-reset': scalable })) {
    $(id).hidden=!available;
    $(id).disabled=!available||busy||preview;
  }
  const conversion=terrainSkinConversion();$('terrain-conversion').hidden=!conversion.eligible||!!conversion.blocked||busy||preview;
  $('convert-terrain-skin').disabled=busy||preview||!conversion.eligible||!!conversion.blocked;
  UI.curve.hidden=preview||tool!=='curve';UI.properties.dataset.mode=tool==='curve'?'curve':'object';
  const colorTarget = !preview && tool==='select' && supportsInstanceAppearance(module) ? direct.instanceId : undefined;
  appearancePanel?.sync(colorTarget, state.document.instanceAppearances?.find(row=>row.instanceId===colorTarget)?.appearance, !!(busy || frozen));
  canvas?.controls({ tool, selected, preview, gameFrame, busy, hidden, hiddenObjects,locked,terrainSelection, curveSelection: { curveId: selectedCurve, pointIndex: selectedCurvePoint }, showGrid: $('grid').checked, showCollision: $('collision').checked });
}
function terrainSkinConversion(){
  const direct=state.document.instances.find(i=>i.instanceId===selected),assembly=state.document.assemblyInstances.find(i=>i.instanceId===selected),owner=direct??assembly;
  const skins=(state.scene.terrainSkins??[]).filter(s=>direct?s.instanceId===selected:assembly&&s.instanceId.startsWith(selected+'/'));
  const eligible=!!owner&&skins.length===1;
  if(!eligible)return {eligible:false};
  const terrain=state.document.layers.find(l=>l.kind==='terrain'),layer=state.document.layers.find(l=>l.layerId===owner.layerId),
    blocked=locked.has(selected)||locked.has(owner.layerId)||locked.has(terrain?.layerId)?'请先解锁平台及地形图层。'
      :hiddenObjects.has(selected)||hidden.has(owner.layerId)||hidden.has(terrain?.layerId)||layer?.visible===false||terrain?.visible===false?'请先显示平台及地形图层。':'';
  return {eligible,blocked,owner,cells:skins[0].cells};
}
async function convertTerrainSkin(){
  if(busy||preview)return false;const conversion=terrainSkinConversion();
  if(!conversion.eligible)return status(errorMessages.TERRAIN_SKIN_CONVERSION_TARGET,true);
  if(conversion.blocked)return status(conversion.blocked,true);
  const instanceId=selected;
  if(await commands([{type:'convert-terrain-skin',instanceId}])){
    selected='';selectedCurve='';terrainSelection=conversion.cells[0]?{cell:{...conversion.cells[0]}}:null;
    renderSelection();markLayerSelection();controls();status('已替换完整平台外观，原格子和碰撞保留。现在可用画刷继续；一次撤销可恢复。',false,true);return true;
  }return false;
}
function activeCurve() { return state.document.curveTerrains?.find(curve => curve.curveId === selectedCurve); }
async function moveTerrain(target,{dx,dy}) {
  if(busy||preview)return;
  const region=regionForTarget(terrainRegions(state.document,{grid:state.scene.grid,presets:metadata.presets,terrainSkins:state.scene.terrainSkins}),target);
  if(!region)return;
  const block=terrainMoveBlock(region,state.document,{locked,hidden,hiddenObjects});if(block)return status(block,true);
  if(await commands([{type:'move-terrain',target,dx,dy}])) {
    terrainSelection=target.cell?{cell:{x:target.cell.x+dx/state.scene.grid.width,y:target.cell.y+dy/state.scene.grid.height}}:target;
    controls();status('整块地形已移动，连接与平台外壳保留；一次撤销可恢复。');
  }
}
async function addCurvePoint(curveId, x) {
  const terrain = state.document.layers.find(layer => layer.kind === 'terrain');
  if (busy || preview || !terrain?.visible || hidden.has(terrain.layerId) || locked.has(terrain.layerId)) return;
  const source = state.document.curveTerrains?.find(curve => curve.curveId === curveId);
  if (!source) return;
  const plan = insertCurvePoint(source, x);
  if (!plan.curve) return status(plan.message, true);
  if (await commands([{ type: 'replace-curve-terrain', curve: plan.curve }])) {
    selected = ''; selectedCurve = curveId; selectedCurvePoint = plan.pointIndex;
    renderCurvePanel(); markLayerSelection(); controls(); status('已沿曲线插入控制点，可直接拖动；一次撤销可恢复。');
  }
}
function currentCurveJoin() {
  const curve = activeCurve(); return curve ? findCurveJoinWithBaseSnap(state.document, curve, selectedCurvePoint, camera?.scale ?? 1) : null;
}
function activeGridLink(){const curve=activeCurve(),endpoint=curve?curveEndpoint(curve,selectedCurvePoint):null;return state.document.terrainConnections?.find(c=>c.curveId===selectedCurve&&c.endpoint===endpoint);}
function currentGridConnection(){const curve=activeCurve();return curve?findGridConnection(state.document,curve,selectedCurvePoint,camera?.scale??1,gridTargets):null;}
function gridConnectionHint(candidate){$('grid-connection-hint').textContent=activeGridLink()?'此端点已连接格子平台；解除连接后才能移动。':candidate
  ?candidate.blocked?errorMessages[candidate.blocked]:'已找到格子接头；松手或点击连接，格子数据保留。'
  :'首轮支持同封底的矩形格子平台；连接后共享材质与轮廓。';}
async function commitGridConnection(candidate){
  if(!candidate)return status('附近没有符合条件的矩形格子接头。',true);
  const batch=[...(state.document.format==='ai_scene_document_v2'?[{type:'enable-mixed-terrain'}]:[]),candidate.command];
  if(await commands(batch)){renderCurvePanel();controls();status('已连接格子平台，保留格子数据，共用连续材质和闭合轮廓；一次撤销可恢复。');}
}
function curveJoinHint(join, dragging = false) {
  $('curve-join-hint').textContent = !join ? '选择端点，或将端点拖近另一条曲线的接头。'
    : join.blocked ? errorMessages[join.blocked] ?? '当前接头无法合并，本次操作会保留原地图。'
      : join.baseSnap ? dragging ? '封底已吸附对齐，松手合并；一次撤销可恢复。' : '相近封底将自动对齐，点击合并；一次撤销可恢复。'
        : dragging ? '已吸附，松手合并；一次撤销可恢复。' : '附近有可合并的端点，可直接点击合并。';
}
async function commitCurveJoin(join) {
  if (!join) return status('附近没有可连接的另一条曲线端点。', true);
  if (await commands(join.commands??[join.command])) {
    if (join.merged) { selectedCurve = join.merged.curve.curveId; selectedCurvePoint = join.merged.joinPointIndex; }
    renderCurvePanel(); controls(); status('两条曲线已合并，共用一个连接点；撤销可恢复合并前的两条曲线。');
  }
}
function updateCurveFields() {
  const curve = activeCurve(), point = curve?.points[selectedCurvePoint], frozen = busy || preview || locked.has(state.document.layers.find(l=>l.kind==='terrain')?.layerId);
  for (const id of ['curve-x', 'curve-y', 'curve-base', 'apply-curve']) $(id).disabled = frozen || !point;
  $('curve-slope').disabled = frozen || !point || selectedCurvePoint === 0 || selectedCurvePoint === curve.points.length - 1;
  $('add-curve').disabled = frozen;
  $('remove-curve').disabled = frozen || !curve;
  $('insert-curve-point').disabled = frozen || !point || selectedCurvePoint >= curve.points.length - 1 || curve.points.length >= 32;
  $('delete-curve-point').disabled = frozen || !point || selectedCurvePoint === 0 || selectedCurvePoint === curve.points.length - 1;
  const join = currentCurveJoin(); $('join-curves').disabled = frozen || !join; curveJoinHint(join);
  const link=activeGridLink(),candidate=currentGridConnection();
  $('add-mixed').disabled=frozen;$('connect-grid').disabled=frozen||!candidate;$('disconnect-grid').disabled=frozen||!link;gridConnectionHint(candidate);
  if(link){$('curve-x').disabled=true;$('curve-y').disabled=true;}
  if(state.document.terrainConnections?.some(c=>c.curveId===selectedCurve))$('curve-base').disabled=true;
}
function renderCurvePanel() {
  const curves = state.document.curveTerrains ?? [];
  if (selectedCurve&&!curves.some(curve => curve.curveId === selectedCurve)) selectedCurve = '';
  const curve = activeCurve(); selectedCurvePoint = Math.min(selectedCurvePoint, Math.max(0, (curve?.points.length ?? 1) - 1));
  $('curve-selection').replaceChildren(new Option('未选择', ''), ...curves.map(curve => new Option(curve.curveId, curve.curveId)));
  $('curve-selection').value = selectedCurve;
  $('curve-point').replaceChildren(...(curve ? curve.points.map((p, i) => new Option(`${i + 1} · (${p.x}, ${p.y})`, String(i))) : [new Option('未选择', '')]));
  $('curve-point').value = curve ? String(selectedCurvePoint) : '';
  const point = curve?.points[selectedCurvePoint];
  setNumericValue('curve-x', point?.x); setNumericValue('curve-y', point?.y);
  setNumericValue('curve-slope', point?.slope); setNumericValue('curve-base', curve?.baseY);
  $('curve-info').textContent = curve ? `${curve.points.length} 个控制点 · ${state.scene.curveTerrains.find(item => item.curveId === curve.curveId).surface.length} 个轮廓采样点。碰撞为建议，未接物理引擎。`
    : '添加小样将明确升级为 v2 地图，并向右扩建一屏。';
  updateCurveFields();
}
function renderAppearance() {
  const study = terrainAppearance === 'study';
  $('terrain-appearance').value = terrainAppearance;
  const candidate = metadata.kit.purpose === 'art-candidate';
  $('appearance-badge').textContent = candidate ? study ? '局部美术候选 / 地形试样' : '局部美术候选 / 整包未验收'
    : study ? '地形试样 / 环境仍为工程标记' : '合成素材 / 工程样例';
  $('appearance-note').textContent = study
    ? `${metadata.terrainPreview.purpose === 'synthetic-simulation' ? '合成来源测试；' : '材料源已接受；'}模块外观未评审。纹理每 4 格循环。地图保存保留布局。`
    : metadata.kitMaterial?.bodyLoopSha256 ? '岩体与表层来自当前资产包，保存和导出可保留。岩体使用原色循环素材，整包美术待验收。'
    : metadata.kitMaterial ? `地形拼片与曲线材质均来自当前资产包，保存和导出可保留。材质每 ${['ai_scene_continuous_terrain_appearance_v2', 'ai_scene_continuous_terrain_appearance_v3'].includes(metadata.kitMaterial.format) ? 8 : 4} 格横向重复；整包美术待验收。`
      : metadata.terrainPreview ? '可切换到连续材质地形试样；切换外观不修改布局或撤销记录。'
      : candidate ? '含局部美术候选，整包未验收。外观与地图布局分开管理。' : '当前仅配置合成素材。外观与地图布局分开管理。';
  $('library-art-note').textContent = candidate ? '当前含局部场景美术候选；地形仍为试样或工程夹具，整包未验收。'
    : study ? '地形缩略图展示形状，画布按位置选片。环境仍用工程标记；当前为未评审试样。' : '当前图形用于验证规则；真实美术生成尚未接入。';
}
async function switchAppearance(next) {
  if (busy) return;
  busy = true; controls(); status('正在准备地形外观…');
  try {
    await canvas.setTerrainAppearance(next); terrainAppearance = next;
    renderAppearance(); renderPalette(); status('地形外观已切换；地图布局与撤销记录保持原样。');
  } catch { renderAppearance(); status('地形试样载入失败，原外观与地图保留。', true); }
  finally { busy = false; renderSelection(); controls(); }
}
function setTool(next, id = '') { tool = next; chosen = id;if(next!=='select')terrainSelection=null;
  if(next==='curve'&&!selectedCurve&&state.document.curveTerrains?.length){selected='';selectedCurve=state.document.curveTerrains[0].curveId;selectedCurvePoint=1;renderCurvePanel();markLayerSelection();}
  renderSelection(); controls(); renderPalette(); }
function activeBrush(){return findBrush(metadata.brushes,selectedBrushId);}
function paletteSelected(kind,id){return kind==='brush'?tool===brushTool(findBrush(metadata.brushes,id))&&selectedBrushId===id:tool===`place-${kind}`&&chosen===id;}
function selectBrush(id){const brush=findBrush(metadata.brushes,id),next=brushTool(brush);if(!next)return false;selectedBrushId=id;setTool(next);return true;}
function brushImage(module){return terrainAppearance==='study'&&module.terrainSignature!==undefined
  ?metadata.terrainPreview.modules.find(item=>item.key===`p0-blob-${String(module.terrainSignature).padStart(3,'0')}`).url:module.url;}
function renderBrushPreview(){
  if(!$('brush-preview').open)return;const brush=activeBrush(),key=`${brush?.brushId}/${terrainAppearance}`;if(brushPreviewKey===key)return;brushPreviewKey=key;
  const host=$('brush-tiles');host.replaceChildren();
  if(terrainAppearance!=='study'&&brush?.previewExamples){
    for(const example of brush.previewExamples){const figure=make('figure'),image=make('img');image.src=example.url;image.alt=example.label;image.draggable=false;figure.append(image,make('figcaption',example.label));host.append(figure);}return;
  }
  for(const id of brush?.tileAssetIds??[]){const module=metadata.modules.find(item=>item.assetId===id);if(!module)continue;
    const figure=make('figure'),image=make('img');image.src=brushImage(module);image.alt='拼接形状 '+id.slice(-3);image.draggable=false;figure.append(image,make('figcaption',id.slice(-3)));host.append(figure);}
}
function markLayerSelection(){document.querySelectorAll('.layer-object').forEach(row=>row.setAttribute('aria-selected',String(row.dataset.instanceId===(selected||selectedCurve))));}
function select(id) { terrainSelection=null;selected = id; selectedCurve=''; renderSelection();markLayerSelection(); controls(); }
function uid() { return `user.${crypto.randomUUID()}`; }
async function mutate(action, extra = {}) {
  if (busy || preview) return false;
  busy = true;savePending=true;let received=false;controls(); status('正在应用修改…');
  try {
    const response = await fetch('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json',
      Accept: terrainEditResponse, 'X-Scene-Kit-Base': state.scene.contentSha256 },
      body: JSON.stringify({ revision: state.revision, action, ...extra }) });
    const { scenePatch, terrainPatch, ...result } = await response.json();
    if (!response.ok) {
      received=true;
      const issue = result.errors?.[0];
      const code = issue?.code ?? result.code;
      if (code === 'STALE_REVISION') saveProblem = 'stale';
      throw new Error(errorMessages[code] ?? `${code}${issue ? ` · ${issue.path} · ${issue.message}` : ''}`);
    }
    if (terrainPatch) result.scene = applyTerrainEditPatch(state.scene, terrainPatch);
    else if (scenePatch) {
      if (scenePatch.baseContentSha256 !== state.scene.contentSha256) throw new Error('Scene patch base changed');
      const nodes = new Map(scenePatch.nodes.map(node => [node.nodeId, node]));
      result.scene = { ...state.scene, source: scenePatch.source, contentSha256: scenePatch.contentSha256,
        layers: state.scene.layers.map(layer => layer.nodes.some(node => nodes.has(node.nodeId))
          ? { ...layer, nodes: layer.nodes.map(node => nodes.get(node.nodeId) ?? node) } : layer) };
    }
    received=true;saveProblem='';
    state = { ...state, ...result };
    if(state.workspace)savedHash=state.scene.source.authorSha256;
    if (scenePatch) {
      appearancePanel?.cancel();
      canvas.updateObjects(state.scene, state.document, scenePatch.nodes);
      renderRevision();
    } else renderDocument();
    status(action === 'import' ? '地图已打开；全部资源和地图规则校验通过。' : '修改已应用。');
    return true;
  } catch (error) {
    if(!received){saveProblem||='unconfirmed';status('与本机编辑器的连接已中断，保存结果尚未确认。可先下载当前地图副本，恢复服务后刷新核对。',true);}
    else status(error.message || '操作未完成，当前文档已保留。', true); return false;
  } finally { busy = false;savePending=false;renderSelection({rebuild:false}); controls(); }
}
const commands = items => {
  const bounds=state.scene.worldBounds;
  const outside=items.some(command=>{
    const adding=['add-instance','place-generated-environment'].includes(command.type);
    const instance=adding?command.instance:['move-instance','transform-instance'].includes(command.type)?state.document.instances.find(i=>i.instanceId===command.instanceId):null;
    if(!instance)return false;
    const module=metadata.modules.find(m=>m.assetId===instance.assetId);if(!module||module.terrainSkin)return false;
    const x=adding?instance.x:command.x,y=adding?instance.y:command.y;
    return x<bounds.x||y<bounds.y||x>=bounds.x+bounds.width||y>=bounds.y+bounds.height;
  });
  const terrainEdit=items.some(item=>['paint-cells','erase-cells','add-curve-terrain','replace-curve-terrain','join-curve-terrains','connect-curve-grid','move-terrain','remove-curve-terrain','expand-assembly','remove-assembly','convert-terrain-skin'].includes(item.type)
    ||(item.type==='place-assembly'&&metadata.presets.find(p=>p.presetId===item.instance?.presetId)?.hasTerrain));
  const layered=state.document.format!=='ai_scene_document_v6'&&terrainEdit&&((state.document.curveTerrains?.length??0)>0||items.some(item=>item.type==='add-curve-terrain'));
  const upgrade=outside&&!['ai_scene_document_v5','ai_scene_document_v6'].includes(state.document.format);
  const superseded=new Set(['enable-free-placement','enable-instance-transforms','enable-curve-terrain','enable-mixed-terrain']);
  return mutate('commands',{commands:[...(layered?[{type:'enable-layered-terrain'}]:upgrade?[{type:'enable-free-placement'}]:[]),...items.filter(item=>layered?!superseded.has(item.type):!upgrade||item.type!=='enable-instance-transforms')]});
};
function paletteDraggable(element,payload){
  element.dataset.assetKind=payload.kind;element.dataset.assetId=payload.id;
  element.dataset.dragTitle=element.title||'拖到画布中放置';element.title=preview?'退出 Play Mode 后可拖入素材':element.dataset.dragTitle;element.disabled=preview||busy;
  const clear=()=>{paletteDrag=null;canvas?.clearDrop();};
  bindPaletteDrag(element,{enabled:()=>!preview&&!busy,
    start(){paletteDrag=payload;UI.properties.hidden=true;$('canvas-options').open=false;},
    move:event=>canvas.previewLibraryDrop(payload,event),
    drop(event){const position=canvas.libraryPoint(event);clear();if(position)void dropAsset(payload,position);},cancel:clear});
}
function assetTitle(id) {
  const label=state.assetNames?.[id];
  if(typeof label==='string')return label;
  return isGeneratedEnvironment({assetId:id,kind:'environment'}) ? '环境素材 '+id.slice(-6) : friendlyAsset(id);
}
function layerLabel(entry) {
  if(entry.brushCells!==undefined||!entry.items.length)return entry.label;
  const names=[...new Set(entry.items.map(item=>assetTitle(item.assetId??item.presetId)))];
  return names.slice(0,2).join(' / ')+(names.length>2?` +${names.length-2}`:'');
}
function groupLayerLabel(entry, group) {
  const label=layerLabel(entry);
  return group?.rows.some(row=>row!==entry&&layerLabel(row)===label)
    ? label+' · '+friendlyAsset(entry.layer.layerId) : label;
}
function placementTarget(payload) {
  const module=payload.kind==='module'?metadata.modules.find(m=>m.assetId===payload.id&&m.kind!=='terrain'):null;
  const preset=payload.kind==='preset'?metadata.presets.find(p=>p.presetId===payload.id):null;
  const terrain=state.document.layers.find(l=>l.kind==='terrain');
  if(!module&&!preset&&!['brush','terrain','curve'].includes(payload.kind))
    return {module,preset,blocked:true,message:'没有可用的目标图层'};
  const destination=module?.placementRole?environmentPlacement(state.document.layers,module.placementRole,activeLayer):null;
  const layer=module?.placementRole?destination?.layer
    :module||preset?placementLayer(state.document.layers,module??preset,activeLayer,!!preset?.hasTerrain,state.document.instances):terrain;
  if(!layer)return {module,preset,blocked:true,message:'没有可用的目标图层'};
  const role=layerGroupLeaves(layerGroups).find(group=>group.rows.some(row=>row.layer.layerId===layer.layerId&&!row.split));
  const entry=role?.rows.find(row=>row.layer.layerId===layer.layerId);
  const blocked=[layer,...(preset?.hasTerrain?[terrain]:[])].some(item=>!item?.visible||hidden.has(item.layerId)||locked.has(item.layerId));
  const name=entry?groupLayerLabel(entry,role):module?.placementRole?environmentLibraryRoleLabel(module.placementRole):layer.layerId;
  return {module,preset,layer,blocked,createLayer:destination?.create,
    message:`目标图层 · ${name}${blocked?'（隐藏或锁定）':destination?.create?'（放置时新建）':''}`};
}
async function dropAsset(payload,position){
  if(preview||busy)return;
  const grid=state.scene.grid,cell={x:Math.floor(position.x/grid.width),y:Math.floor(position.y/grid.height)};
  const target=placementTarget(payload),{module,preset,layer}=target;
  if(target.blocked)return status(target.message,true);
  if(payload.kind==='brush'){if(!selectBrush(payload.id))return;return stroke('paint',[cell]);}
  if(payload.kind==='terrain'){if(!metadata.modules.some(m=>m.assetId===payload.id&&m.kind==='terrain'))return;return stroke('paint',[cell]);}
  if(payload.kind==='curve'){
    if(!['hill','valley','slope'].includes(payload.id))return;
    const left=cell.x*grid.width,startY=Math.round(position.y),end=left+grid.width*4,bottom=Math.min(state.scene.worldBounds.y+state.scene.worldBounds.height,startY+160);
    const curve={curveId:uid(),familyId:metadata.familyId,profile:'sideview-height-curve-v1',baseY:bottom,points:[{x:left,y:startY,slope:0},{x:left+grid.width*2,y:startY+(payload.id==='valley'?64:-64),slope:0},{x:end,y:payload.id==='slope'?startY-96:startY,slope:0}]};
    const batch=[...(state.document.format==='ai_scene_document_v1'?[{type:'enable-curve-terrain'}]:[]),{type:'add-curve-terrain',curve}];
    if(await commands(batch)){selected='';selectedCurve=curve.curveId;selectedCurvePoint=1;renderCurvePanel();setTool('curve');renderLayers();}return;
  }
  if(preset){
    const candidate=presetPlacement(preset,position,state.scene,state.document,metadata.presets);
    if(candidate.code)return status(candidate.message,true);
  }
  const id=uid(),instance=module?{instanceId:id,assetId:module.assetId,layerId:layer.layerId,x:Math.round(position.x),y:Math.round(position.y)}
    :{instanceId:id,presetId:preset.presetId,layerId:layer.layerId,column:cell.x,row:cell.y};
  const type=target.createLayer?'place-generated-environment':module?'add-instance':'place-assembly';
  if(await commands([{type,instance}])){tool='select';selected=id;selectedCurve='';renderSelection();renderLayers();controls();}
}
function transformSelected(scale){const item=state.document.instances.find(i=>i.instanceId===selected);if(item)void resizeObject(item.instanceId,item.x,item.y,scale);}
async function resizeObject(instanceId,x,y,scale){
  const item=state.document.instances.find(i=>i.instanceId===instanceId);if(!item||locked.has(instanceId)||locked.has(item.layerId))return;
  return commands([...(!['ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(state.document.format)?[{type:'enable-instance-transforms'}]:[]),
    {type:'transform-instance',instanceId,x:Math.round(x),y:Math.round(y),scale:Math.max(.125,Math.min(8,Math.round(scale*1000)/1000))}]);
}
function place(cell,position) {
  if (preview || busy) return;
  const { grid } = state.scene;
  if (tool === 'paint' || tool === 'erase') return stroke(tool, [cell]);
  if(['place-module','place-preset','place-curve'].includes(tool))return dropAsset({kind:tool.slice(6),id:chosen},position??{x:cell.x*grid.width,y:cell.y*grid.height});
  status('先选择画刷、擦除工具、环境块或组合。');
}
async function stroke(kind, cells) {
  if(busy||preview)return false;
  const command=kind==='paint'?brushStroke(activeBrush(),cells):{type:'erase-cells',cells};
  if(!command)return status('请先选择一个可用画刷。',true);
  const plan=planTerrainStroke({command,document:state.document,presets:metadata.presets,scene:state.scene,locked,hidden,hiddenObjects});
  if(plan.code){status(plan.message,true);return false;}
  if(!plan.commands.length){status(plan.message);return true;}
  const applying = commands(plan.commands);
  status('正在应用这笔地形，完成后可继续绘制。', false, true);
  const ok = await applying;
  if(ok&&plan.disconnectedCount)status('地形已编辑，原矩形接头已解除；平台与曲线可分别移动，一次撤销恢复。',false,true);
  else if(ok&&plan.expandedCount)status('已擦除；涉及的组合已转为可编辑地形，一次撤销可完整恢复。');return ok;
}
function renderPaletteGroup(group, tab) {
  const {role,label,rows,children}=group, key=tab+'/'+role;
  const section=make('details',undefined,'palette-group'), summary=make('summary');
  const cardCount=items=>items.filter(item=>!item.hasAttribute('data-environment-generate')).length;
  const count=make('span',String(children?children.reduce((total,child)=>total+cardCount(child.rows),0):cardCount(rows)),'palette-group-count');
  count.setAttribute('aria-hidden','true');summary.append(make('span',label),count);
  section.dataset.paletteGroup=role;section.open=!paletteFolded.has(key);section.append(summary);
  section.ontoggle=()=>{
    if(section.isConnected) section.open?paletteFolded.delete(key):paletteFolded.add(key);
  };
  if(children) section.append(...children.filter(child=>child.rows.length).map(child=>renderPaletteGroup(child,tab)));
  else {
    const cards=make('div',undefined,tab==='terrain'?'asset-list terrain-brushes':'asset-list');
    cards.append(...rows);section.append(cards);
  }
  return section;
}
function renameAsset(id) {
  if(!state.workspace||busy||preview)return;
  const dialog=make('dialog',undefined,'asset-name-dialog'), form=make('form'), input=make('input');
  const title=make('h2','重命名素材'), label=make('label','素材名称'), output=make('p');
  dialog.setAttribute('aria-label','重命名素材');
  input.required=true;input.maxLength=60;input.value=assetTitle(id);
  label.append(input);output.setAttribute('role','status');
  const cancel=make('button','取消'),save=make('button','保存名称','primary');
  cancel.type='button';cancel.onclick=()=>dialog.close();save.type='submit';
  const actions=make('div',undefined,'button-row');actions.append(cancel,save);
  form.append(title,label,output,actions);dialog.append(form);document.body.append(dialog);
  const focusCard=()=>document.querySelector(`[data-rename-asset="${CSS.escape(id)}"]`)?.focus();
  dialog.addEventListener('close',()=>{dialog.remove();focusCard();},{once:true});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  form.onsubmit=async event=>{
    event.preventDefault();
    if(busy||!input.value.trim())return;
    busy=savePending=true;controls();input.disabled=save.disabled=cancel.disabled=true;
    output.textContent='正在保存…';
    let received=false;
    try {
      const response=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'rename-asset',revision:state.revision,assetId:id,name:input.value.trim()})});
      const result=await response.json();received=true;
      if(!response.ok){
        if(result.code==='STALE_REVISION')saveProblem='stale';
        throw new Error(result.message??'名称保存失败。');
      }
      saveProblem='';
      state={...state,...result};
      renderRevision();renderLayers();renderPalette();
      status('素材名称已保存。',false,true);
      dialog.close();
    } catch(error) {
      if(!received)saveProblem||='unconfirmed';
      output.textContent=received?error.message:'连接中断，名称保存结果待核对。';
    } finally {
      busy=savePending=false;input.disabled=save.disabled=cancel.disabled=false;
      controls();
    }
  };
  dialog.showModal();input.select();
}
function renderPalette() {
  const host = $('palette'), cardsByRole=new Map(), assetRole=paletteAssetRoles(state.document);
  for (const item of ['terrain', 'environment', 'presets','curves']) $(`tab-${item}`).setAttribute('aria-pressed', String(item === category));
  host.className='palette-tree';
  function add(role,button,payload,card=button){
    if(!cardsByRole.has(role))cardsByRole.set(role,[]);
    button.dataset.assetGroup=role;paletteDraggable(button,payload);cardsByRole.get(role).push(card);
  }
  if(category==='terrain'){
    for(const brush of metadata.brushes.filter(item=>brushTool(item))){
      const button=make('button'),image=make('img'),module=metadata.modules.find(item=>item.assetId===brush.previewAssetId);
      button.setAttribute('aria-label',brush.name);button.setAttribute('aria-pressed',String(paletteSelected('brush',brush.brushId)));button.title='选择后拖动画布绘制';button.dataset.brushId=brush.brushId;
      if(terrainAppearance!=='study'&&brush.previewUrl)image.src=brush.previewUrl;else if(module)image.src=brushImage(module);image.alt='';image.draggable=false;
      const label=make('span',brush.name),mark=icon('check');mark.classList.add('brush-selected-mark');label.append(make('small',brush.description));button.append(image,label,mark);button.onclick=()=>selectBrush(brush.brushId);
      add('terrain',button,{kind:'brush',id:brush.brushId});
    }
  }else if(category==='curves'){
    for(const [id,label]of [['hill','丘陵'],['valley','谷地'],['slope','缓坡']]){
      const b=make('button');b.append(icon('curve'),make('span',label));b.setAttribute('aria-pressed',String(paletteSelected('curve',id)));b.title='点击后在画布放置，或直接拖到画布；Esc取消';b.onclick=()=>setTool('place-curve',id);
      add('terrain',b,{kind:'curve',id});
    }
  }else if (category === 'presets') {
    for (const preset of metadata.presets) {
      const button = make('button'); button.setAttribute('aria-label', `放置组合 ${preset.presetId}`);
      button.setAttribute('aria-pressed', String(paletteSelected('preset',preset.presetId)));
      const glyph=presetThumbnail(preset,metadata,terrainAppearance);
      const label = make('span', friendlyAsset(preset.presetId)); label.append(make('small', `${preset.sizeCells.width} × ${preset.sizeCells.height} 格`));
      button.append(glyph, label); button.onclick = () => setTool('place-preset', preset.presetId);
      add(assetRole('preset',preset),button,{kind:'preset',id:preset.presetId});
    }
  } else {
    for (const module of metadata.modules.filter(item => item.kind !== 'terrain')) {
      const button = make('button'), label=assetTitle(module.assetId);
      button.title = label; button.setAttribute('aria-label', `放置模块 ${state.assetNames?.[module.assetId]??module.assetId}`);
      button.setAttribute('aria-pressed', String(paletteSelected('module',module.assetId)));
      const image = make('img');
      image.src = module.url;
      image.alt = ''; image.width = 45; image.height = 45;image.draggable=false;
      const text = make('span', label);
      button.append(image, text);
      button.onclick = () => setTool('place-module', module.assetId);
      const card=make('div',undefined,'asset-card');
      card.classList.toggle('asset-fresh',freshAsset===module.assetId);
      card.append(button);
      if(state.workspace){
        const rename=make('button','✎','asset-rename');rename.type='button';
        rename.dataset.renameAsset=module.assetId;rename.title='重命名素材';
        rename.setAttribute('aria-label','重命名素材 '+label);rename.onclick=()=>renameAsset(module.assetId);
        card.append(rename);
        if (openEnvironmentAnimation && supportsEnvironmentAnimation(module)) {
          const animation = make('button', '动画', 'asset-animation');
          animation.type = 'button';
          animation.dataset.animationType = module.animation?.type ?? 'static';
          animation.title = ({ static: '静态', idle: '默认 · Idle', interactive: '交互物' })[animation.dataset.animationType];
          animation.setAttribute('aria-label', '编辑动画 ' + label);
          animation.onclick = () => openEnvironmentAnimation(module, label);
          card.append(animation);
        }
      }
      add(assetRole('module',module),button,{kind:'module',id:module.assetId},card);
    }
    if(openEnvironmentLibrary)for(const role of environmentLibraryRoles){
      const generate=make('button',undefined,'environment-generate');
      generate.dataset.environmentGenerate=role;
      generate.disabled=preview||busy;
      const plus=make('span','+','environment-generate-plus');
      plus.setAttribute('aria-hidden','true');
      const label=role==='environment'?'生成环境素材':'生成'+environmentLibraryRoleLabel(role)+'素材';
      generate.append(plus,make('span',label));
      generate.onclick=()=>openEnvironmentLibrary(role);
      cardsByRole.set(role,[...(cardsByRole.get(role)??[]),generate]);
    }
  }
  const groups=sceneGroupTree(cardsByRole);
  host.replaceChildren(...(groups.length?groups.map(group=>renderPaletteGroup(group,category)):[make('p','当前分类暂无素材','muted')]));
  renderBrushPreview();
}
function renderSelection({ rebuild = true } = {}) {
  const direct = state.document.instances.find(item => item.instanceId === selected);
  const assembly = state.document.assemblyInstances.find(item => item.instanceId === selected);
  const found = direct ?? assembly;
  if (!found) selected = '';
  if (rebuild) $('selection').replaceChildren(new Option('未选择', ''), ...[...state.document.instances, ...state.document.assemblyInstances].map(item => new Option(`${item.instanceId} · ${item.presetId ?? item.assetId}`, item.instanceId)));
  $('selection').value = selected;
  $('selection-info').textContent = found ? `${assembly ? '组合预设' : '环境实例'} · ${found.presetId ?? found.assetId}${assembly ? '（展开后编辑地形）' : ''}` : '选择环境块或组合预设。';
  setNumericValue('object-x', direct?.x); setNumericValue('object-y', direct?.y);
  for (const id of ['object-x', 'object-y', 'move']) $(id).disabled = !direct || preview || busy;
  $('duplicate').disabled = !found || preview || busy;
  $('delete').disabled = !found || preview || busy;
  $('expand').disabled = !assembly || preview || busy;
  $('extend').disabled = preview || busy; $('apply-cell').disabled = preview || busy;
}
function selectLayer(layer) {
  activeLayer=layer.layerId;
  if(layer.kind==='terrain') {
    selected='';selectedCurve='';
    setTool('paint');markLayerSelection();
  } else controls();
}
function layerTreeHeading({id,label,controlsLabel,rows,className,sourceLayer,selectRow}) {
  const head=make('div',undefined,className), eye=make('label',undefined,'layer-eye'), input=make('input');
  const members=rows.flatMap(({layer,items,split})=>split?items.map(item=>({layer,objectId:item.instanceId})):[{layer,items}]);
  const visibleMembers=members.filter(({layer})=>layer.visible);
  const isVisible=({layer,objectId})=>!hidden.has(layer.layerId)&&(!objectId||!hiddenObjects.has(objectId));
  const shown=visibleMembers.filter(isVisible).length;
  input.type='checkbox';input.checked=shown>0&&shown===visibleMembers.length;
  input.indeterminate=shown>0&&!input.checked;input.disabled=!visibleMembers.length;
  input.setAttribute('aria-label','显示'+controlsLabel);
  input.onchange=()=>{
    for(const {layer,objectId} of visibleMembers){
      if(input.checked){hidden.delete(layer.layerId);if(objectId)hiddenObjects.delete(objectId);}
      else if(objectId)hiddenObjects.add(objectId);
      else hidden.add(layer.layerId);
    }
    renderLayers();controls();
  };
  eye.append(input,icon('eye'));
  const toggle=button('folder','展开或收起'+(sourceLayer?' ':'分组 ')+label,()=>{
    folded.has(id)?folded.delete(id):folded.add(id);renderLayers();
  });
  toggle.className='layer-icon';toggle.setAttribute('aria-expanded',String(!folded.has(id)));
  const title=make('span',label,'layer-title');
  if(sourceLayer)title.title=sourceLayer.layerId;
  if(selectRow){
    title.onclick=selectRow;title.tabIndex=0;title.setAttribute('role','button');
    title.setAttribute('aria-label','设为放置目标 '+label);
    title.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();selectRow();}};
  }
  const isLocked=({layer,objectId})=>locked.has(layer.layerId)||(objectId&&locked.has(objectId));
  const allLocked=members.length>0&&members.every(isLocked);
  const someLocked=members.some(member=>isLocked(member)||member.items?.some(item=>locked.has(item.instanceId)));
  const lock=button('lock','锁定'+controlsLabel,()=>{
    for(const {layer,objectId,items} of members){
      if(allLocked){
        locked.delete(layer.layerId);
        if(objectId)locked.delete(objectId);
        for(const item of items??[])locked.delete(item.instanceId);
      }
      else locked.add(objectId??layer.layerId);
    }
    renderLayers();controls();
  });
  lock.className='layer-icon';lock.disabled=!members.length;lock.setAttribute('aria-pressed',allLocked?'true':someLocked?'mixed':'false');
  head.append(eye,toggle,title,lock);return head;
}
const attachLayerReorder=createLayerReorder({
  canEdit:id=>!busy&&!preview&&!locked.has(id),
  async move(ids,source) {
    const peers=state.document.layers.filter(layer=>ids.includes(layer.layerId)).sort((a,b)=>b.zIndex-a.zIndex);
    if(peers.some((layer,index)=>locked.has(layer.layerId)&&ids[index]!==layer.layerId))
      return status('请先解锁需要调整顺序的图层。',true);
    if(await commands([{type:'reorder-layers',layerIds:ids}])) {
      document.querySelector(`[data-source-layer="${CSS.escape(source)}"] .layer-reorder-handle`)?.focus({preventScroll:true});
      status(state.workspace?'图层顺序已保存，可撤销。':'已调整图层顺序，可撤销。',false,true);
    }
  },
});
const ownerLayer=id=>state.document.instances.find(item=>item.instanceId===id)?.layerId
  ?? state.document.assemblyInstances.find(item=>item.instanceId===id)?.layerId;
const attachObjectReorder=createLayerReorder({
  kind:'object',
  canEdit:id=>!busy&&!preview&&!locked.has(id)&&!locked.has(ownerLayer(id)),
  async move(ids, source, previous) {
    if(previous.some((id,index)=>locked.has(id)&&ids[index]!==id))
      return status('请先解锁需要调整顺序的对象。',true);
    if(await commands([{type:'reorder-layer-objects',layerId:ownerLayer(source),instanceIds:ids}])) {
      document.querySelector(`[data-reorder-object="${CSS.escape(source)}"]`)?.focus({preventScroll:true});
      status(state.workspace?'对象顺序已保存，可撤销。':'已调整对象顺序，可撤销。',false,true);
    }
  },
});
function renderLayer(entry, displayName=layerLabel(entry), group) {
    const {rowId,layer,items,split,brushCells}=entry, row=make('div',undefined,'layer-row');
    row.dataset.sourceLayer=layer.layerId;
    const heading=layerTreeHeading({id:rowId,label:displayName,controlsLabel:(split?'分类 '+displayName+' · ':'图层 ')+layer.layerId,
      rows:[entry],className:'layer-heading',sourceLayer:layer,selectRow:()=>selectLayer(layer)});
    heading.title=layer.layerId+' · 层级 '+layer.zIndex;
    if(group)attachLayerReorder(heading,layer.layerId,reorderableLayers(group).map(row=>row.layer.layerId),group.groupId,displayName);
    row.append(heading);
    if(folded.has(rowId))return row;
    if(brushCells!==undefined){
      const brush=button('paint','画刷地形',()=>selectLayer(layer));brush.className='layer-brush';
      brush.disabled=!layer.visible||hidden.has(layer.layerId)||locked.has(layer.layerId);
      brush.append(make('span','画刷地形','layer-title'),make('span',`${brushCells} 格`,'layer-brush-count'));row.append(brush);
    }
    const objectIds=brushCells===undefined?items.map(item=>item.instanceId):[];
    for(const item of items){
      const id=item.instanceId??item.curveId,b=make('div',undefined,'layer-object');b.dataset.instanceId=id;b.setAttribute('role','option');b.tabIndex=0;b.setAttribute('aria-selected',String(id===(item.curveId?selectedCurve:selected)));
      const m=metadata.modules.find(m=>m.assetId===item.assetId),thumb=m?make('img'):icon(item.curveId?'curve':'layers');if(m){thumb.src=m.url;thumb.alt='';thumb.draggable=false;}thumb.classList.add('layer-thumb');
      const name=make('span',item.curveId?'曲线地形':assetTitle(item.assetId??item.presetId),'layer-title');name.title=id;b.append(thumb,name);
      b.onclick=()=>{if(item.curveId){selected='';selectedCurve=id;selectedCurvePoint=0;renderCurvePanel();setTool('curve');markLayerSelection();}else{tool='select';select(id);}};
      b.ondblclick=event=>{if(!event.target.closest('button'))item.curveId?canvas.frameCurve(id):canvas.frameSelection(id);};
      b.onkeydown=e=>{if(e.target===b&&['Enter',' '].includes(e.key)){e.preventDefault();b.click();}};
      const eye=make('label',undefined,'layer-eye'),visible=make('input');visible.type='checkbox';visible.checked=!hiddenObjects.has(id);visible.setAttribute('aria-label','显示对象 '+id);
      visible.onchange=()=>{visible.checked?hiddenObjects.delete(id):hiddenObjects.add(id);if(split)renderLayers();controls();};eye.onclick=e=>e.stopPropagation();eye.append(visible,icon('eye'));if(!item.curveId)b.prepend(eye);
      attachObjectReorder(b,id,objectIds,rowId,name.textContent);
      row.append(b);
    }
    return row;
}
function renderLayerGroup(group, section=false) {
  const {role,label,groupId,rows,children}=group;
  const root=make('div',undefined,section?'layer-section layer-sub-row':'layer-root');
  root.dataset.layerGroup=role;root.dataset.groupId=groupId;
  if(!children&&role!=='empty'&&rows.length===1&&!rows[0].split){root.append(renderLayer(rows[0],label));return root;}
  const members=children?children.flatMap(child=>child.rows):rows;
  const preferred=members.find(row=>row.brushCells!==undefined)??members.find(row=>row.layer.layerId===activeLayer)??members[0];
  root.append(layerTreeHeading({id:groupId,label,controlsLabel:'分组 '+label,rows:members,className:'layer-group-heading',
    selectRow:preferred?()=>selectLayer(preferred.layer):null}));
  if(!folded.has(groupId)){
    if(children)root.append(...children.map(child=>renderLayerGroup(child,true)));
    else if(rows.length)for(const entry of rows){const row=renderLayer(entry,groupLayerLabel(entry,group),group);row.classList.add('layer-sub-row');root.append(row);}
    else root.append(make('p','暂无环境对象','layer-empty-note'));
  }
  return root;
}
function renderLayers() {
  layerGroups=groupSceneLayers(state.document,metadata);
  $('layers').replaceChildren(...layerGroups.map(group=>renderLayerGroup(group)));
}
function renderDocument() {
  gridTargets=gridConnectionTargets(state.scene);
  appearancePanel?.cancel();
  canvas.update(state.scene, state.document);
  $('map-name').textContent = state.document.mapId;
  $('module-count').textContent = `${metadata.modules.length} 模块`;
  $('grid-size').textContent = `${state.scene.grid.width} × ${state.scene.grid.height}`;
  $('bounds-size').textContent = `${state.document.bounds.width} × ${state.document.bounds.height} 格`;
  $('dimensions').textContent = `${state.scene.worldBounds.width} × ${state.scene.worldBounds.height} 逻辑单位`;
  $('counts').textContent = `${state.scene.counts.terrainNodes} 地形 · ${state.scene.counts.visualNodes} 环境${state.scene.curveTerrains?.length ? ` · ${state.scene.curveTerrains.length} 曲线` : ''}${state.document.terrainConnections?.length?` · ${state.document.terrainConnections.length} 格子接头`:''}`;
  renderRevision();
  renderSelection(); renderLayers(); renderPalette(); renderCurvePanel(); minimap(true);
}
function renderRevision() {
  $('digest').textContent = state.scene.source.authorSha256;
  $('digest').title = '作者地图 SHA-256';
  $('save-state').textContent = state.workspace?'已保存到本机':savedHash === state.scene.source.authorSha256 ? '文档无修改' : '有未保存修改';
  document.body.dataset.revision = String(state.revision);
}
function svg(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}
let minimapCamera;
function minimap(rebuild = false) {
  if (!state) return;
  const root = $('minimap'), bounds = state.scene.worldBounds;
  if (rebuild) {
    root.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    root.setAttribute('preserveAspectRatio', 'none'); root.replaceChildren();
    for (const layer of state.scene.layers.filter(layer => layer.kind === 'terrain')) for (const node of layer.nodes) root.append(svg('rect', { ...node.position, ...node.size, fill: '#698a9e' }));
    for (const curve of state.scene.curveTerrains ?? []) root.append(svg('polygon', { points: curve.contour.map(p => `${p.x},${p.y}`).join(' '), fill: '#8bbd83' }));
    minimapCamera = undefined;
  }
  if (!camera) return;
  if (!minimapCamera) {
    minimapCamera = svg('rect', { fill: '#66dfc4', 'fill-opacity': '.09', stroke: '#80f1d9', 'stroke-width': Math.max(bounds.width / 400, 1) });
    root.append(minimapCamera);
  }
  for (const [key, value] of Object.entries(camera.visible)) minimapCamera.setAttribute(key, String(value));
}
function download(name, object) {
  const blob = new Blob([JSON.stringify(object, null, 2) + '\n'], { type: 'application/json' });
  downloadBlob(name, blob);
}
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob), anchor = make('a'); anchor.href = url; anchor.download = name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function applyAnimationSettings(latest) {
  await canvas.addModules(latest.modules, latest.animationAtlases);
  Object.assign(metadata, latest, { animationAtlases: latest.animationAtlases });
  state = latest;
  savedHash = state.scene.source.authorSha256;
  renderDocument();
  status('素材动画已保存到当前项目。', false, true);
}
async function syncGeneratedEnvironment(assetId) {
  if (!canvas || busy || preview || !canvas.canSyncModules()) return;
  busy = true;
  controls();
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('素材库刷新失败');
    const latest = await response.json();
    if (latest.workspace.activeProjectId !== state.workspace.activeProjectId
      || latest.workspace.activeMapId !== state.workspace.activeMapId) return;
    const module=latest.modules.find(item => item.assetId === assetId);
    if (!module) return;
    await canvas.addModules(latest.modules, latest.animationAtlases);
    Object.assign(metadata, latest);
    state = latest;
    savedHash = state.scene.source.authorSha256;
    freshAsset=assetId;
    category='environment';
    const role=paletteAssetRoles(state.document)('module',module);
    paletteFolded.delete('environment/'+role);
    if(role==='environment')paletteFolded.delete('environment/platform');
    renderDocument();
    UI.revealLibrary();
    $('palette').querySelector(`[data-asset-id="${CSS.escape(assetId)}"]`)?.scrollIntoView({block:'nearest'});
    status(`新素材已加入「${environmentLibraryRoleLabel(role)}」，可拖入画布。`, false, true);
  } finally {
    busy = false;
    controls();
  }
}
try {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('无法载入本地资产包。');
  state = await response.json(); metadata = state; savedHash = state.scene?.source.authorSha256;
  if(metadata.environmentLibrary)openEnvironmentLibrary=mountEnvironmentLibrary({
    styleName:metadata.environmentLibrary.styleName,getRevision:()=>state.revision,
    hasAsset:id=>metadata.modules.some(module=>module.assetId===id),
    onAdded:syncGeneratedEnvironment,
  });
  document.body.dataset.revision=String(state.revision);
  const projects=mountProjectUI({getState:()=>state,canOperate:()=>!busy&&!preview,setBusy:value=>{busy=value;if(state.scene)controls();},status});
  if (projects) openEnvironmentAnimation = mountEnvironmentAnimation({
    getState: () => state, canOperate: () => Boolean(canvas && !busy && !preview && canvas.canSyncModules()),
    setBusy: value => { busy = value; controls(); }, apply: applyAnimationSettings, download: downloadBlob,
  });
  if(projects)$('save').title='每次编辑自动保存到本机；此按钮下载当前地图 JSON 副本';
  if(projects)window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  if(!metadata.kit){projects.showEmpty();document.body.dataset.ready='true';}
  else {
  selectedBrushId=metadata.brushes.find(brush=>brushTool(brush))?.brushId??'';$('brush-preview').ontoggle=renderBrushPreview;
  category=metadata.modules.some(m=>m.kind!=='terrain')?'environment':'terrain';
  if (metadata.kitMaterial) $('terrain-appearance').options[0].textContent = '资产包地形（含曲线材质）';
  canvas = await createCanvas($('canvas-host'), metadata, {
    placementTarget,
    animationState(state) { status(`交互状态 · ${state.name}`, false, true); },
    camera(next) { camera = next; $('zoom').textContent = `${Math.round(next.scale * 100)}%`; minimap(); updateCurveFields(); },
    cursor(cell) { $('cursor-position').textContent = `列 ${cell.x} / 行 ${cell.y}`; },
    selection: select, stroke, place, cancel: message => status(message, true),
    drop:dropAsset,dragPayload:()=>paletteDrag,
    resize:resizeObject,
    moveAssembly(item,dx,dy){if(locked.has(item.layerId))return;return commands([{type:'remove-assembly',instanceId:item.instanceId},{type:'place-assembly',instance:{...item,column:item.column+dx,row:item.row+dy}}]);},
    selectionBounds(box){
      UI.floating.hidden=!box||preview||!selected;
      if(box&&!UI.floating.hidden){
        const host=$('canvas-host'),width=UI.floating.offsetWidth,height=UI.floating.offsetHeight;
        const above=box.y-height-12, below=box.y+box.height+12;
        UI.floating.style.left=`${Math.max(10,Math.min(host.clientWidth-width-10,box.x))}px`;
        UI.floating.style.top=`${Math.max(62,Math.min(host.clientHeight-height-10,above>=62?above:below))}px`;
      }
    },
    curveSelection(curveId, pointIndex) { selectedCurve = curveId; selectedCurvePoint = pointIndex; renderCurvePanel(); controls(); },
    terrainSelection(target){terrainSelection=target;selected='';const region=regionForTarget(terrainRegions(state.document,{grid:state.scene.grid,presets:metadata.presets,terrainSkins:state.scene.terrainSkins}),target);selectedCurve=target.curveId??region?.curveIds[0]??'';renderSelection();renderCurvePanel();markLayerSelection();controls();},
    moveTerrain(target,delta){return moveTerrain(target,delta);},
    insertCurvePoint(curveId, x) { void addCurvePoint(curveId, x); },
    replaceCurve(curve) { void commands([{ type: 'replace-curve-terrain', curve }]); },
    joinCurves(join) { void commitCurveJoin(join); },
    curveJoinHint(join) { curveJoinHint(join, true); },
    gridConnectionHint(candidate){gridConnectionHint(candidate);},
    connectGrid(candidate){void commitGridConnection(candidate);},
    move(instanceId, x, y) { return commands([{ type: 'move-instance', instanceId, x, y }]); },
  });
  appearancePanel = mountAppearancePanel($('object-appearance'), UI.properties, {
    preview: (id, appearance) => canvas.previewAppearance(id, appearance),
    commit: (instanceId, appearance) => commands([
      ...(state.document.format==='ai_scene_document_v6' ? [] : [{type:'enable-layered-terrain'}]),
      {type:'set-instance-appearance', instanceId, appearance},
    ]),
  });
  if (metadata.terrainPreview) $('terrain-appearance').append(new Option('连续材质地形试样', 'study'));
  renderDocument(); renderAppearance(); controls(); canvas.home();
  if (metadata.terrainPreview) await switchAppearance('study');
  if (state.scene.curveTerrains?.length) { selectedCurve = state.scene.mixedTerrains?.[0]?.source.curveIds[0]??state.scene.curveTerrains[0].curveId; selectedCurvePoint = 1; renderCurvePanel(); setTool('curve'); if (!metadata.kitMaterial) canvas.frameCurve(selectedCurve); }
  $('loading').hidden = true; document.body.dataset.ready = 'true';
  if (!metadata.terrainPreview || terrainAppearance === 'study') status(terrainAppearance === 'study'
    ? metadata.kit.purpose === 'art-candidate' ? '地形试样与局部环境候选已就绪；整包未验收。可选择游戏视口，进入预览查看视差。'
      : '地形试样已就绪；可刷图、撤销或切换外观对比。环境仍使用工程标记。'
    : '默认地图已就绪。选择画刷开始，或在模块库中放置组合。');
  document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => setTool(button.dataset.tool));
  for (const value of ['terrain', 'environment', 'presets','curves']) $(`tab-${value}`).onclick = () => { category = value; renderPalette(); };
  $('scale-up').onclick=()=>transformSelected((state.document.instanceTransforms?.find(t=>t.instanceId===selected)?.scale??1)*1.1);
  $('scale-down').onclick=()=>transformSelected((state.document.instanceTransforms?.find(t=>t.instanceId===selected)?.scale??1)/1.1);
  $('scale-reset').onclick=()=>transformSelected(1);
  window.addEventListener('pointerdown',e=>{if(!e.target.closest('#canvas-properties,#canvas-options,#selection-tools,#curve-actions')){$('canvas-options').open=false;UI.properties.hidden=true;}});
  $('selection').onchange = () => {
    select($('selection').value);
    const box = selectionBox(state.document, state.scene, metadata.presets, selected);
    if (box) canvas.jump(box.x + box.width / 2, box.y + box.height / 2);
  };
  $('undo').onclick = () => mutate('undo'); $('redo').onclick = () => mutate('redo');
  $('undo').title = '撤销 · Ctrl / ⌘ + Z';
  $('undo').setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
  $('redo').title = '重做 · Ctrl + Y 或 Ctrl / ⌘ + Shift + Z';
  $('redo').setAttribute('aria-keyshortcuts', 'Control+Y Control+Shift+Z Meta+Shift+Z');
  $('fit').onclick = () => canvas.fit(); $('home').onclick = () => canvas.home();
  $('zoom-in').onclick = () => canvas.zoom(1.25); $('zoom-out').onclick = () => canvas.zoom(.8);
  $('grid').onchange = controls; $('collision').onchange = controls;
  $('terrain-appearance').onchange = () => switchAppearance($('terrain-appearance').value);
  $('add-curve').onclick = async () => {
    const sample = curvePreset(state.document, state.scene.grid, uid(), metadata.familyId, $('curve-template').value);
    const batch = [...(state.document.format === 'ai_scene_document_v1' ? [{ type: 'enable-curve-terrain' }] : []),
      { type: 'resize-bounds', bounds: sample.bounds }, { type: 'add-curve-terrain', curve: sample.curve }];
    if (await commands(batch)) { selectedCurve = sample.curve.curveId; selectedCurvePoint = 1; renderCurvePanel(); setTool('curve'); canvas.frameCurve(selectedCurve); }
  };
  $('add-mixed').onclick=async()=>{
    try{const sample=mixedPreset(state.document,uid(),metadata.familyId);if(await commands(sample.commands)){selectedCurve=sample.curveId;selectedCurvePoint=1;renderCurvePanel();setTool('curve');canvas.frameCurve(selectedCurve);}}
    catch(error){status(error.message,true);}
  };
  $('curve-selection').onchange = () => { selectedCurve = $('curve-selection').value; selectedCurvePoint = 0; renderCurvePanel(); setTool('curve'); if (selectedCurve) canvas.frameCurve(selectedCurve); };
  $('curve-point').onchange = () => { selectedCurvePoint = Number($('curve-point').value); renderCurvePanel(); controls(); };
  const numericActions = {
    'object-x': 'move', 'object-y': 'move',
    'curve-x': 'apply-curve', 'curve-y': 'apply-curve', 'curve-slope': 'apply-curve', 'curve-base': 'apply-curve',
    'cell-x': 'apply-cell', 'cell-y': 'apply-cell',
  };
  for (const [id, action] of Object.entries(numericActions)) {
    const input = $(id);
    const error = make('span', undefined, 'coordinate-error');
    error.id = `${id}-error`;
    error.hidden = true;
    input.insertAdjacentElement('afterend', error);
    input.setAttribute('aria-errormessage', error.id);
    input.addEventListener('input', () => clearNumericError(input));
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      $(action).click();
    });
  }
  $('apply-curve').onclick = () => {
    const curve = structuredClone(activeCurve()); if (!curve) return;
    const values = numericValues('curve-x', 'curve-y', 'curve-slope', 'curve-base');
    if (!values) return;
    const [x, y, slope, baseY] = values;
    curve.points[selectedCurvePoint] = { x, y, slope };
    curve.baseY = baseY; void commands([{ type: 'replace-curve-terrain', curve }]);
  };
  $('join-curves').onclick = () => void commitCurveJoin(currentCurveJoin());
  $('connect-grid').onclick=()=>void commitGridConnection(currentGridConnection());
  $('disconnect-grid').onclick=()=>{const link=activeGridLink();if(link)void commands([{type:'disconnect-curve-grid',curveId:link.curveId,endpoint:link.endpoint}]);};
  $('insert-curve-point').onclick = () => {
    const curve = activeCurve(); if (!curve || !curve.points[selectedCurvePoint + 1]) return;
    void addCurvePoint(curve.curveId, (curve.points[selectedCurvePoint].x + curve.points[selectedCurvePoint + 1].x) / 2);
  };
  $('delete-curve-point').onclick = () => { const curve = structuredClone(activeCurve()); if (curve) { curve.points.splice(selectedCurvePoint, 1); void commands([{ type: 'replace-curve-terrain', curve }]); } };
  $('remove-curve').onclick = () => commands([{ type: 'remove-curve-terrain', curveId: selectedCurve }]);
  $('preview').onclick = () => { preview = !preview; $('game-frame').checked=preview; UI.properties.hidden=true; $('canvas-options').open=false;UI.closeDrawers();renderSelection(); controls(); };
  $('preview-camera').onclick=()=>{if(!preview||busy)return;$('game-frame').checked=!$('game-frame').checked;controls();};
  $('game-frame').onchange = controls;
  $('extend').onclick = () => commands([{ type: 'resize-bounds', bounds: { ...state.document.bounds, width: state.document.bounds.width + Math.ceil(state.scene.defaultCamera.viewport.width / state.scene.grid.width) } }]);
  $('move').onclick = () => {
    const values = numericValues('object-x', 'object-y');
    if (!values) return;
    const [x, y] = values;
    return commands([{ type: 'move-instance', instanceId: selected, x, y }]);
  };
  $('delete').onclick = () => commands([{ type: state.document.assemblyInstances.some(item => item.instanceId === selected) ? 'remove-assembly' : 'remove-instance', instanceId: selected }]);
  $('expand').onclick = () => commands([{ type: 'expand-assembly', instanceId: selected }]);
  $('convert-terrain-skin').onclick=()=>void convertTerrainSkin();
  $('duplicate').onclick = () => {
    const direct = state.document.instances.find(item => item.instanceId === selected);
    const assembly = state.document.assemblyInstances.find(item => item.instanceId === selected);
    if (direct){const id=uid(),scale=state.document.instanceTransforms?.find(t=>t.instanceId===selected)?.scale;
      const appearance=state.document.instanceAppearances?.find(row=>row.instanceId===selected)?.appearance;
      void commands([{ type: 'add-instance', instance: { ...direct, instanceId: id, x: direct.x + state.scene.grid.width } },...(scale?[{type:'transform-instance',instanceId:id,x:direct.x+state.scene.grid.width,y:direct.y,scale}]:[]),...(appearance?[{type:'set-instance-appearance',instanceId:id,appearance}]:[])]).then(ok=>{if(ok){selected=id;renderSelection();renderLayers();controls();}});}
    else if (assembly) {
      const preset = metadata.presets.find(item => item.presetId === assembly.presetId);
      commands([{ type: 'place-assembly', instance: { ...assembly, instanceId: uid(), column: assembly.column + preset.sizeCells.width } }]);
    }
  };
  $('apply-cell').onclick = () => {
    const values = numericValues('cell-x', 'cell-y');
    if (!values) return;
    const [x, y] = values;
    return place({ x, y });
  };
  $('save').onclick = () => {
    download('scene.document.json', state.document);
    if(!state.workspace){savedHash=state.scene.source.authorSha256;if(!saveProblem)$('save-state').textContent='已发起下载';}
    status('已发起地图 JSON 下载。',false,true);
  };
  $('compiled').onclick = () => { download('scene.compiled.json', state.scene); if (terrainAppearance === 'study') status('已下载基础资产包的编译场景；不包含当前地形试样外观。'); };
  $('export-pack').onclick = async () => {
    if (busy) return;
    busy = true; controls(); status('正在打包当前地图与资产…');
    try {
      const response = await fetch(`/api/export?revision=${state.revision}`);
      if (!response.ok) throw new Error('地图版本已变化，请刷新后重试导出。');
      downloadBlob('scene-kit-export.zip', await response.blob());
      status(terrainAppearance === 'study' ? '已下载基础资产包 ZIP；外部地形试样外观未写入，完整地形请使用候选包。'
        : '已下载当前地图、PNG、曲线材质和校验清单；解压后可继续编辑。');
    } catch (error) { status(error.message || '打包失败，地图保留。', true); }
    finally { busy = false; controls(); }
  };
  $('open').onclick = () => { if (preview) return status('请先返回地图编辑。'); $('file').click(); };
  let pendingMapRead;
  $('file').onchange = async () => {
    const file = $('file').files?.[0]; $('file').value = '';
    if (!file) return;
    const reading = { revision: state.revision };
    pendingMapRead = reading;
    try {
      if (busy || preview) return status('请先结束当前操作或退出 Play Mode，再打开地图。', true);
      if (file.size > 2000000) return status('地图文件超过导入上限。', true);
      const text = await file.text();
      if (pendingMapRead !== reading) return;
      if (busy || preview || state.revision !== reading.revision)
        return status('读取期间地图或编辑状态已变化，请重新选择要打开的文件。', true);
      const document = JSON.parse(text);
      if(projects)return void projects.importMap(document,file.name);
      if (savedHash !== state.scene.source.authorSha256 && !window.confirm('当前地图有未保存修改。打开所选地图会替换当前地图和撤销历史，是否继续？')) return;
      const imported = await mutate('import', { document });
      if (imported) { selected = ''; savedHash = state.scene.source.authorSha256; renderSelection(); controls(); canvas.home(); $('save-state').textContent = '文档无修改'; }
    } catch {
      if (pendingMapRead === reading) status('无法读取有效的地图 JSON，请检查文件后重试。', true);
    } finally {
      if (pendingMapRead === reading) pendingMapRead = undefined;
    }
  };
  $('minimap').onclick = event => {
    const rect = $('minimap').getBoundingClientRect(), bounds = state.scene.worldBounds;
    canvas.jump(bounds.x + (event.clientX - rect.left) / rect.width * bounds.width, bounds.y + bounds.height / 2);
  };
  $('minimap').onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') canvas.home();
    else canvas.jump(camera.visible.x + camera.visible.width / 2 + (event.key === 'ArrowRight' ? 1 : -1) * state.scene.defaultCamera.viewport.width / 2, camera.visible.y + camera.visible.height / 2);
  };
  window.addEventListener('keydown', event => {
    const target = event.target;
    if (event.defaultPrevented || event.isComposing || event.altKey || !(target instanceof Element) || target.closest('dialog')) return;
    const editingField = target.isContentEditable || target.closest('input,select,textarea');
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      const sceneHistory = !editingField || target.matches('input[type=checkbox],input[type=radio]');
      if (sceneHistory && (key === 'z' || key === 'y')) {
        event.preventDefault();
        if (!event.repeat) $(key === 'y' || event.shiftKey ? 'redo' : 'undo').click();
      }
      if (key === 's') {
        event.preventDefault();
        if (!event.repeat) $('save').click();
      }
      return;
    }
    if (editingField) return;
    if(event.key==='Escape'){
      if(preview)$('preview').click();else if(tool.startsWith('place-')&&!busy)setTool('select');
      return;
    }
    if (preview && !target.closest('#minimap') && ['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) {
      $('minimap').onkeydown(event); return;
    }
    const tools = { v: 'select', b: 'paint', e: 'erase', c: 'curve', h: 'pan' };
    if (event.repeat) return;
    if (tools[key] && !preview && !busy) setTool(tools[key]);
    if (event.key === 'Delete' && selected) $('delete').click();
  });
  window.addEventListener('beforeunload', event => { if (savedHash !== state.scene.source.authorSha256) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => canvas.destroy(), { once: true });
  }
} catch (error) { $('loading').textContent = error.message || '工作台无法启动。'; status(error.message || '工作台无法启动。', true); }
