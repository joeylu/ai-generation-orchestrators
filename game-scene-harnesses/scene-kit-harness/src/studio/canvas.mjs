import { Application, Assets, Graphics, UPDATE_PRIORITY } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { selectionBox, hitSelection, strokeCells } from './geometry.mjs';
import { createSceneView, loadTerrainMaterial } from '../pixi/scene-view.mjs';
import { loadModuleTextures } from '../pixi/texture-load.mjs';
import { terrainStudyTextureKey } from '../pixi/terrain-appearance.mjs';
import { sampleCurve } from '../curves.mjs';
import { curveHandle } from './curve-tools.mjs';
import {snapTerrainBase,findCurveJoinWithBaseSnap} from './terrain-base-snap.mjs';
import { findGridConnection,gridConnectionTargets } from '../mixed-terrain.mjs';
import {resizeFromCorner,corners} from './transform-tools.mjs';
import {presetPlacement} from './preset-placement.mjs';
import { findCurveSurface } from './curve-insertion.mjs';
import {terrainRegions,regionForTarget,hitTerrainRegion,terrainMoveBlock,terrainMoveDelta} from '../terrain-move.mjs';

function objectMoveDelta({ start, current, assembly, snapToGrid }, grid) {
  const dx = current.x - start.x, dy = current.y - start.y;
  if (!assembly && !snapToGrid) return { dx, dy };
  return { dx: Math.round(dx / grid.width) * grid.width, dy: Math.round(dy / grid.height) * grid.height };
}

export async function createCanvas(element, metadata, callbacks) {
  const app = new Application();
  await app.init({ width: element.clientWidth, height: element.clientHeight, background: '#101a26',
    preference: 'webgl', antialias: false, autoDensity: true, resolution: Math.min(devicePixelRatio || 1, 2) });
  // Keep viewport input and animation clocks active without redrawing a static scene.
  app.ticker.remove(app.render, app);
  let needsRender = true;
  element.append(app.canvas);
  app.canvas.setAttribute('aria-label', '横版地图画布');
  const viewport = new Viewport({ screenWidth: app.screen.width, screenHeight: app.screen.height,
    worldWidth: 4096, worldHeight: 576, events: app.renderer.events, ticker: app.ticker,
    passiveWheel: false, disableOnContextMenu: true, allowPreserveDragOutside: true });
  app.stage.addChild(viewport);
  viewport.drag({ mouseButtons: 'right-middle' }).wheel({ smooth: false }).clampZoom({ minScale: .08, maxScale: 4 });
  const mapBackdrop = new Graphics(), guides = new Graphics(), overlay = new Graphics(), gameMask = new Graphics();
  app.stage.addChild(gameMask);
  const loadedTextureUrls = new Set();
  async function loadTexture(url) {
    const texture = await Assets.load(url);
    loadedTextureUrls.add(url);
    return texture;
  }
  const textures = await loadModuleTextures(metadata.modules, module => loadTexture(module.url));
  const atlasTextures = new Map(), atlasUrls = new Map();
  async function addAnimationAtlases(atlases = {}) {
    const requested = Object.entries(atlases).filter(([sha256]) => !atlasTextures.has(sha256))
      .map(([sha256, url]) => ({ assetId: sha256, url, source: { sha256 } }));
    const added = await loadModuleTextures(requested, module => loadTexture(module.url));
    for (const [sha256, texture] of added) {
      atlasTextures.set(sha256, texture);
      atlasUrls.set(sha256, atlases[sha256]);
    }
  }
  await addAnimationAtlases(metadata.animationAtlases);
  let terrainAppearance = 'fixture', terrainTextures, curveMaterials;
  const kitMaterial = await loadTerrainMaterial(metadata.kitMaterial, item => loadTexture(item.url));
  element.dataset.terrainAppearance = terrainAppearance;
  let animationPress, animationFocus;
  const view = createSceneView({ resolveTexture: id => textures.get(id),
    resolveAnimationAtlas: source => atlasTextures.get(source.sha256),
    onAnimationState(nodeId, state) {
      if (nodeId === animationFocus) callbacks.animationState?.(state);
    }, resolveNodeTexture(node) {
    if (terrainAppearance !== 'study') return undefined;
    const key = terrainStudyTextureKey(node);
    if (key === null) return undefined;
    const texture = terrainTextures?.get(key);
    if (!texture) throw new Error('地形试样缺少当前格需要的拼接片。');
    return texture;
  }, resolveCurveMaterial() { return terrainAppearance === 'study' ? curveMaterials : kitMaterial; } });
  viewport.addChild(mapBackdrop, view.root, guides, overlay);
  let scene, document, hidden = new Set(),hiddenObjects=new Set(),locked=new Set(), selected = '', tool = 'select',dropPreview=null,
    preview = false, gameFrame = false, framing = false, editCamera = null, showGrid = true, showCollision = false, busy = false, gesture = null,pending=null,
    curveSelection = { curveId: '', pointIndex: 0 }, gridTargets=[],regions=[],terrainSelection=null;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  app.ticker.add(tick => {
    const animationChanged = (preview || !reduceMotion.matches) && view.advanceAnimations(tick.elapsedMS);
    if (needsRender || animationChanged) {
      needsRender = false;
      app.render();
    }
  }, undefined, UPDATE_PRIORITY.LOW);
  const abort = new AbortController(), { signal } = abort;
  app.canvas.addEventListener('webglcontextrestored', () => { needsRender = true; }, { signal });
  const dropHint=element.ownerDocument.createElement('div');dropHint.className='canvas-drop-hint';dropHint.hidden=true;element.parentElement.append(dropHint);

  const point = event => {
    const rect = app.canvas.getBoundingClientRect();
    return viewport.toWorld((event.clientX - rect.left) * app.screen.width / rect.width, (event.clientY - rect.top) * app.screen.height / rect.height);
  };
  const cell = position => ({ x: Math.floor(position.x / scene.grid.width), y: Math.floor(position.y / scene.grid.height) });
  function libraryPoint(event){const rect=app.canvas.getBoundingClientRect();return !preview&&!busy&&event.clientX>=rect.left&&event.clientX<rect.right&&event.clientY>=rect.top&&event.clientY<rect.bottom?point(event):null;}
  const hitMasks=new Map();
  function pixelHit(item,box,p){
    if(!item.assetId)return true;
    try{if(!hitMasks.has(item.assetId)){const texture=textures.get(item.assetId),w=128,h=Math.max(1,Math.round(w*texture.height/texture.width));
      const target=new OffscreenCanvas(w,h),ctx=target.getContext('2d',{willReadFrequently:true});ctx.drawImage(texture.source.resource,0,0,w,h);hitMasks.set(item.assetId,{w,h,rgba:ctx.getImageData(0,0,w,h).data});}
      const m=hitMasks.get(item.assetId),x=Math.min(m.w-1,Math.max(0,Math.floor((p.x-box.x)/box.width*m.w))),y=Math.min(m.h-1,Math.max(0,Math.floor((p.y-box.y)/box.height*m.h)));return m.rgba[(y*m.w+x)*4+3]>8;
    }catch{return true;}
  }
  const hit=p=>hitSelection(p,document,scene,metadata.presets,new Set([...hidden,...hiddenObjects]),locked,pixelHit);
  function scalable(){const item=document?.instances.find(i=>i.instanceId===selected),module=metadata.modules.find(m=>m.assetId===item?.assetId);return item&&module&&!module.terrainSkin&&module.kind!=='strip'&&!locked.has(item.layerId)&&!locked.has(selected);}

  function cameraChanged() {
    if (!scene || framing) return;
    let visible;
    if (preview && gameFrame) {
      framing = true;
      try {
        const frame = scene.defaultCamera.viewport, bounds = scene.worldBounds;
        const scale = Math.min(app.screen.width / frame.width, app.screen.height / frame.height);
        const clamp = (value, origin, extent, window) => extent <= window ? origin + extent / 2
          : Math.max(origin + window / 2, Math.min(origin + extent - window / 2, value));
        const center = { x: clamp(viewport.center.x, bounds.x, bounds.width, frame.width),
          y: clamp(viewport.center.y, bounds.y, bounds.height, frame.height) };
        viewport.setZoom(scale, true); viewport.moveCenter(center.x, center.y);
        const mapStart=viewport.toScreen(bounds.x,bounds.y),mapEnd=viewport.toScreen(bounds.x+bounds.width,bounds.y+bounds.height);
        const left=Math.max((app.screen.width-frame.width*scale)/2,mapStart.x),top=Math.max((app.screen.height-frame.height*scale)/2,mapStart.y);
        const right=Math.min((app.screen.width+frame.width*scale)/2,mapEnd.x),bottom=Math.min((app.screen.height+frame.height*scale)/2,mapEnd.y);
        gameMask.clear().rect(left,top,Math.max(0,right-left),Math.max(0,bottom-top)).fill(0xffffff);
        viewport.mask = gameMask;
        visible = { x: center.x - frame.width / 2, y: center.y - frame.height / 2, width: frame.width, height: frame.height };
      } finally { framing = false; }
    } else { viewport.mask = null; gameMask.clear(); visible = viewport.getVisibleBounds(); }
    view.setCamera({ center: viewport.center, visible, preview });
    drawGuides(); drawOverlay();
    callbacks.camera({ visible: { x: visible.x, y: visible.y, width: visible.width, height: visible.height }, scale: viewport.scale.x });
  }
  function drawGuides() {
    if (!scene) return;
    const scale = viewport.scale.x, { grid, worldBounds: bounds } = scene;
    guides.clear();
    if (!preview && showGrid && grid.width * scale >= 10 && grid.height * scale >= 10) {
      const visible = viewport.getVisibleBounds();
      const left = Math.max(bounds.x, Math.floor(visible.x / grid.width) * grid.width);
      const right = Math.min(bounds.x + bounds.width, visible.x + visible.width);
      const top = Math.max(bounds.y, Math.floor(visible.y / grid.height) * grid.height);
      const bottom = Math.min(bounds.y + bounds.height, visible.y + visible.height);
      for (let x = left; x <= right; x += grid.width) guides.moveTo(x, Math.max(top, bounds.y)).lineTo(x, bottom);
      for (let y = top; y <= bottom; y += grid.height) guides.moveTo(Math.max(left, bounds.x), y).lineTo(right, y);
      guides.stroke({ color: 0x8da9bf, alpha: .14, width: 1 / scale });
    }
    if (!preview && showCollision) {
      for (const edge of scene.collisionSuggestions.boundarySegments) guides.moveTo(edge.from.x, edge.from.y).lineTo(edge.to.x, edge.to.y);
      guides.stroke({ color: 0xf4aa75, width: 2 / scale });
      for (const edge of scene.collisionSuggestions.standingSurfaces) guides.moveTo(edge.from.x, edge.from.y).lineTo(edge.to.x, edge.to.y);
      guides.stroke({ color: 0x85f4c2, width: 3 / scale });
      for (const curve of [...scene.collisionSuggestions.curveContours ?? [],...scene.collisionSuggestions.mixedContours??[]]) {
        guides.poly(curve.contour.flatMap(p => [p.x, p.y])).stroke({ color: 0xf4aa75, width: 2 / scale });
      }
    }
    if (!preview) guides.rect(bounds.x, bounds.y, bounds.width, bounds.height).stroke({ color: 0x6687a3, alpha: .65, width: 1 / scale });
  }
  function drawOverlay() {
    needsRender = true;
    element.dataset.gesture=gesture?.kind??'';
    element.dataset.pendingGesture=pending?.kind??'';
    const visualGesture=gesture??pending;
    const baseSnap=visualGesture?.baseSnap??gesture?.join?.baseSnap;
    element.dataset.terrainBaseSnap=baseSnap?.kind??'';
    element.dataset.terrainSelected=terrainSelection?JSON.stringify(terrainSelection):'';
    dropHint.hidden=true;delete element.dataset.dropValid;
    overlay.clear();
    if (!scene || preview){callbacks.selectionBounds?.(null);return;}
    const box = selectionBox(document, scene, metadata.presets, selected);
    const owner = document.instances.find(item => item.instanceId === selected) ?? document.assemblyInstances.find(item => item.instanceId === selected);
    if (box && !hidden.has(owner.layerId)&&!hiddenObjects.has(selected)) {
      const { dx, dy } = visualGesture?.kind === 'move' ? objectMoveDelta(visualGesture, scene.grid) : { dx: 0, dy: 0 };
      const shown=visualGesture?.kind==='resize'?visualGesture.rect:{...box,x:box.x+dx,y:box.y+dy};
      overlay.rect(shown.x, shown.y, shown.width, shown.height).stroke({ color: 0x8affdf, width: 1.5 / viewport.scale.x });
      if(visualGesture?.kind==='move'){
        const piece=visualGesture.assembly&&regionForTarget(regions,{assemblyId:selected});
        if(piece)view.previewTerrain(piece,{dx,dy});else view.previewTransform('visual/'+selected,{dx,dy});
        if (gesture?.snapToGrid && !gesture.assembly) {
          const cursor = viewport.toScreen(gesture.current.x, gesture.current.y);
          dropHint.textContent = '按格移动';
          dropHint.dataset.error = 'false';
          dropHint.style.left = `${Math.max(8, Math.min(app.screen.width - 100, cursor.x + 14))}px`;
          dropHint.style.top = `${Math.max(8, Math.min(app.screen.height - 40, cursor.y + 18))}px`;
          dropHint.hidden = false;
        }
      }
      if(visualGesture?.kind==='resize')view.previewTransform('visual/'+selected,shown);
      if(scalable())for(const [,x,y]of corners(shown)){const r=4.5/viewport.scale.x;overlay.rect(x-r,y-r,r*2,r*2).fill(0xe8fff7).stroke({color:0x25473f,width:1/viewport.scale.x});}
      const screen=viewport.toScreen(shown.x,shown.y);callbacks.selectionBounds?.({x:screen.x,y:screen.y,width:shown.width*viewport.scale.x,height:shown.height*viewport.scale.x});
    }else callbacks.selectionBounds?.(null);
    const region=tool==='select'&&regionForTarget(regions,terrainSelection);
    if(region&&!hidden.has(region.terrainLayerId)) {
      const {dx=0,dy=0}=visualGesture?.kind==='terrain-move'?visualGesture.delta:{},b=region.bounds;
      const inside=b.x+dx>=scene.worldBounds.x&&b.y+dy>=scene.worldBounds.y&&b.x+b.width+dx<=scene.worldBounds.x+scene.worldBounds.width&&b.y+b.height+dy<=scene.worldBounds.y+scene.worldBounds.height;
      const color=inside?0x8affdf:0xff9980;
      overlay.rect(b.x+dx,b.y+dy,b.width,b.height).stroke({color,width:1.5/viewport.scale.x});
      if(visualGesture?.kind==='terrain-move')view.previewTerrain(region,{dx,dy});
    }
    if(dropPreview){const p=dropPreview,preset=p.payload.kind==='preset'?metadata.presets.find(item=>item.presetId===p.payload.id):null;
      const candidate=preset?presetPlacement(preset,p.position,scene,document,metadata.presets):null;
      const target=callbacks.placementTarget?.(p.payload),blocked=!!(candidate?.code||target?.blocked);
      const mod=metadata.modules.find(m=>m.assetId===p.payload.id),scale=mod?.renderStyle?.scale,density=metadata.pixelsPerUnit?metadata.pixelsPerUnit.numerator/metadata.pixelsPerUnit.denominator:1;
      const ratio=(scale?scale.numerator/scale.denominator:1)/density;
      const brushBox=p.payload.kind==='brush'?{x:Math.floor(p.position.x/scene.grid.width)*scene.grid.width,y:Math.floor(p.position.y/scene.grid.height)*scene.grid.height,width:scene.grid.width,height:scene.grid.height}:null;
      const box=candidate?.bounds??brushBox??{x:p.position.x+(mod?.visualOffset.x??0)-(mod?.anchorPx.x??0)*ratio,y:p.position.y+(mod?.visualOffset.y??0)-(mod?.anchorPx.y??0)*ratio,width:(mod?.pixelSize.width??scene.grid.width)*ratio,height:(mod?.pixelSize.height??scene.grid.height)*ratio};
      const color=blocked?0xff9980:0x8affdf;
      if(candidate)for(const run of candidate.runs)overlay.rect(run.x*scene.grid.width,run.y*scene.grid.height,run.length*scene.grid.width,scene.grid.height).fill({color,alpha:.28});
      overlay.rect(box.x,box.y,box.width,box.height).fill({color,alpha:.08}).stroke({color,width:2/viewport.scale.x});
      if(candidate||target){const cursor=viewport.toScreen(p.position.x,p.position.y);dropHint.hidden=false;
        dropHint.textContent=candidate?.code?candidate.message:[target?.message,candidate?.message].filter(Boolean).join(' · ');
        dropHint.dataset.error=String(blocked);element.dataset.dropValid=String(!blocked);
        dropHint.style.left=`${Math.max(8,Math.min(app.screen.width-280,cursor.x+14))}px`;dropHint.style.top=`${Math.max(8,Math.min(app.screen.height-60,cursor.y+18))}px`;}
    }
    if (visualGesture?.cells) {
      for (const item of visualGesture.cells.values()) overlay.rect(item.x * scene.grid.width, item.y * scene.grid.height, scene.grid.width, scene.grid.height);
      overlay.fill({ color: visualGesture.kind === 'erase' ? 0xfb9980 : 0x86edc8, alpha: .4 });
    }
    const terrainLayer = scene.layers.find(layer => layer.kind === 'terrain');
    if (tool === 'curve' && terrainLayer?.visible && !hidden.has(terrainLayer.layerId)) {
      const merge = gesture?.join?.merged;
      const curves = merge ? merge.curves : document.curveTerrains ?? [];
      for (const original of curves) {
        const curve = gesture?.curve?.curveId === original.curveId ? gesture.curve : original;
        const displayed = merge && curve.curveId === merge.curve.curveId ? merge.curve : curve;
        if (gesture?.curve === curve || displayed === merge?.curve) {
          try {
            if (!displayed.points.every((point, i) => !i || point.x - displayed.points[i - 1].x >= 32)) throw new Error('point order');
            const line = sampleCurve(displayed);
            overlay.poly([...line.flatMap(p => [p.x, p.y]), line.at(-1).x, displayed.baseY, line[0].x, displayed.baseY]).fill({ color: 0x96e4a3, alpha: .22 });
            overlay.poly(line.flatMap(p => [p.x, p.y]), false).stroke({ color: 0xc6ffd0, width: 2 / viewport.scale.x });
          } catch { overlay.poly(displayed.points.flatMap(p => [p.x, p.y]), false).stroke({ color: 0xffaa8e, width: 2 / viewport.scale.x }); }
        }
        for (const [index, point] of displayed.points.entries()) {
          const active = merge ? displayed.curveId === merge.curve.curveId && index === merge.joinPointIndex
            : curve.curveId === curveSelection.curveId && index === curveSelection.pointIndex;
          overlay.circle(point.x, point.y, (active ? 7 : 5) / viewport.scale.x).fill(active ? 0xf4cf7d : 0xc6ffd0)
            .stroke({ color: 0x13251c, width: 1.5 / viewport.scale.x });
          if (active) {
            const handle = curveHandle(displayed, index);
            if (handle) {
              overlay.moveTo(point.x, point.y).lineTo(handle.x, handle.y).stroke({ color: 0xf4cf7d, width: 1 / viewport.scale.x });
              const half = 5 / viewport.scale.x;
              overlay.rect(handle.x - half, handle.y - half, half * 2, half * 2).fill(0xf4cf7d);
            }
          }
        }
      }
      if (gesture?.join) overlay.circle(gesture.join.target.x, gesture.join.target.y, 13 / viewport.scale.x)
        .stroke({ color: gesture.join.blocked ? 0xffaa8e : 0x66dfc4, width: 2 / viewport.scale.x });
      if(gesture?.grid)overlay.circle(gesture.grid.target.x,gesture.grid.target.y,13/viewport.scale.x)
        .stroke({color:gesture.grid.blocked?0xffaa8e:0x79b8ef,width:2/viewport.scale.x});
    }
    if(baseSnap){
      overlay.moveTo(baseSnap.xFrom,baseSnap.y).lineTo(baseSnap.xTo,baseSnap.y).stroke({color:0x79e2d1,width:2/viewport.scale.x});
      const p=viewport.toScreen((baseSnap.xFrom+baseSnap.xTo)/2,baseSnap.y);dropHint.hidden=false;dropHint.dataset.error='false';
      dropHint.textContent=baseSnap.kind==='map'?'封底已吸附地图底边':'封底已吸附相邻地形';
      dropHint.style.left=`${Math.max(8,Math.min(app.screen.width-200,p.x+12))}px`;dropHint.style.top=`${Math.max(8,Math.min(app.screen.height-40,p.y-34))}px`;
    }
  }
  function setCursor() { app.canvas.style.cursor = busy ? 'wait' : tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'; }
  function cancel({clearPending=false}={}) {
    animationPress = undefined;
    if(clearPending)pending=null;
    if(!pending)view.resetPreview();
    const id = gesture?.id; gesture = null;
    element.dataset.curveJoin = '';
    callbacks.curveJoinHint?.(null);
    element.dataset.gridConnection='';callbacks.gridConnectionHint?.(null);
    if (id !== undefined && app.canvas.hasPointerCapture(id)) app.canvas.releasePointerCapture(id);
    viewport.pause = true;
    viewport.plugins.resume('drag');
    viewport.pause = busy;
    drawOverlay();
  }
  function submitPreview(finished,commit) {
    // Release capture, but keep the last visual position while the one request
    // validates. A successful scene update replaces it in the same JS turn.
    pending=finished;cancel();
    const settle=()=>{if(pending===finished){pending=null;view.resetPreview();drawOverlay();}};
    const failed=()=>{settle();callbacks.cancel('保存未完成，请检查连接后再操作。');};
    try{Promise.resolve(commit()).then(settle,failed);}catch{failed();}
  }
  function addStroke(position) {
    const next = cell(position);
    const distance = Math.max(Math.abs(next.x - gesture.last.x), Math.abs(next.y - gesture.last.y));
    if (distance > 10000 || gesture.cells.size + distance > 10000) { cancel(); callbacks.cancel('笔划过长，已取消；请分段绘制。'); return; }
    for (const item of strokeCells(gesture.last, next)) gesture.cells.set(`${item.x},${item.y}`, item);
    gesture.last = next; drawOverlay();
  }
  function updateCurveGesture(position) {
    if (gesture.kind === 'curve-point') {
      gesture.curve.points[gesture.index].x = Math.round(gesture.anchor.x + position.x - gesture.start.x);
      gesture.curve.points[gesture.index].y = Math.round(gesture.anchor.y + position.y - gesture.start.y);
      if (Math.hypot(position.x - gesture.start.x, position.y - gesture.start.y) * viewport.scale.x >= 3) gesture.moved = true;
      gesture.join = gesture.moved ? findCurveJoinWithBaseSnap(document, gesture.curve, gesture.index, viewport.scale.x) : null;
      gesture.grid=gesture.moved?findGridConnection(document,gesture.curve,gesture.index,viewport.scale.x,gridTargets):null;
      if(gesture.grid&&(!gesture.join||gesture.grid.distance<gesture.join.distance))gesture.join=null;else gesture.grid=null;
      element.dataset.curveJoin = gesture.join ? gesture.join.blocked ? 'blocked' : 'ready' : '';
      element.dataset.gridConnection=gesture.grid?gesture.grid.blocked?'blocked':'ready':'';
      callbacks.curveJoinHint?.(gesture.join);
      callbacks.gridConnectionHint?.(gesture.grid);
    } else gesture.curve.points[gesture.index].slope = Math.round((position.y - gesture.anchor.y) / gesture.tangentLength * 1000) / 1000;
  }
  function updateTerrainMove(position) {
    const delta=terrainMoveDelta(gesture.region,gesture.start,position,scene.grid);
    if(Math.hypot(position.x-gesture.start.x,position.y-gesture.start.y)*viewport.scale.x>=3)gesture.moved=true;
    const plan=gesture.moved?snapTerrainBase(document,gesture.region,delta,{grid:scene.grid,worldBounds:scene.worldBounds,scale:viewport.scale.x}):{delta,snap:null};
    gesture.delta=plan.delta;gesture.baseSnap=plan.snap;
  }
  app.canvas.addEventListener('pointerdown', event => {
    if(gesture&&event.button===2){event.preventDefault();cancel();return;}
    if (!scene || busy || gesture || pending || event.button !== 0 || (event.pointerType === 'touch' && !event.isPrimary)) return;
    const position = point(event);
    if (preview) { animationPress = { id: event.pointerId, x: event.clientX, y: event.clientY }; return; }
    if (tool === 'pan') return;
    event.preventDefault();
    viewport.pause = true;
    if (tool === 'paint' || tool === 'erase') {
      gesture = { id: event.pointerId, kind: tool, cells: new Map(), last: cell(position) };
      addStroke(position);
    } else if (tool === 'curve') {
      const terrain = scene.layers.find(layer => layer.kind === 'terrain');
      if (terrain && terrain.visible && !hidden.has(terrain.layerId) && !locked.has(terrain.layerId)) {
        const current = document.curveTerrains?.find(curve => curve.curveId === curveSelection.curveId);
        const tangent = current ? curveHandle(current, curveSelection.pointIndex) : null;
        const anchors = (document.curveTerrains ?? []).flatMap(curve => curve.points.map((p, index) => ({ curve, index,
          distance: Math.hypot(position.x - p.x, position.y - p.y), active: curve.curveId === curveSelection.curveId && index === curveSelection.pointIndex }))
          .filter(hit => hit.distance <= 10 / viewport.scale.x)).sort((a, b) => a.distance - b.distance || Number(b.active) - Number(a.active));
        let hit = anchors[0];
        const tangentDistance = tangent ? Math.hypot(position.x - tangent.x, position.y - tangent.y) : Infinity;
        if (tangentDistance <= 10 / viewport.scale.x && (!hit || (hit.distance > 5 / viewport.scale.x && tangentDistance < hit.distance)))
          hit = { curve: current, index: curveSelection.pointIndex, tangent };
        if (hit) {
          callbacks.curveSelection(hit.curve.curveId, hit.index);
          const anchor = hit.curve.points[hit.index];
          const locked=document.terrainConnections?.some(c=>c.curveId===hit.curve.curveId&&c.endpoint===(hit.index===0?'start':hit.index===hit.curve.points.length-1?'end':null));
          if(!locked)gesture = { id: event.pointerId, kind: hit.tangent ? 'curve-tangent' : 'curve-point', curve: structuredClone(hit.curve),
            index: hit.index, start: position, anchor: { ...anchor }, tangentLength: hit.tangent?.length };
        }
      }
      if (!gesture) viewport.pause = false;
      drawOverlay();
    } else if (tool === 'select') {
      const box=selectionBox(document,scene,metadata.presets,selected),corner=box&&scalable()?corners(box).find(([,x,y])=>Math.hypot(position.x-x,position.y-y)<=10/viewport.scale.x):null;
      if(corner){const direct=document.instances.find(i=>i.instanceId===selected),currentScale=document.instanceTransforms?.find(t=>t.instanceId===selected)?.scale??1;
        gesture={id:event.pointerId,kind:'resize',start:position,box,rect:box,corner:corner[0],direct,currentScale};app.canvas.setPointerCapture(event.pointerId);drawOverlay();return;}
      selected = hit(position);
      const owner=document.instances.find(i=>i.instanceId===selected)??document.assemblyInstances.find(i=>i.instanceId===selected);
      const bound=regions.find(r=>r.assemblyIds.includes(selected)||r.instanceIds.includes(selected));
      const preset=owner?.presetId&&metadata.presets.find(p=>p.presetId===owner.presetId);
      const isolatedAssembly=bound&&preset&&bound.assemblyIds.length===1&&!bound.curveIds.length&&bound.cells.length===preset.terrainRuns.reduce((n,r)=>n+r.length,0);
      if(isolatedAssembly){const block=terrainMoveBlock(bound,document,{locked,hidden,hiddenObjects});if(block){viewport.pause=false;callbacks.cancel(block);return;}}
      const surface=hitTerrainRegion(regions,position,scene.grid),terrain=scene.layers.find(l=>l.kind==='terrain');
      const terrainHit=isolatedAssembly?null:bound?{region:bound,target:bound.assemblyIds.includes(selected)?{assemblyId:selected}:{cell:bound.cells[0]}}
        :surface&&terrain.visible&&!hidden.has(terrain.layerId)&&(!owner||document.layers.find(l=>l.layerId===owner.layerId).zIndex<terrain.zIndex)?surface:null;
      if(terrainHit) {
        const block=terrainMoveBlock(terrainHit.region,document,{locked,hidden,hiddenObjects});
        if(block){viewport.pause=false;callbacks.cancel(block);return;}
        selected='';callbacks.terrainSelection(terrainHit.target);
        gesture={id:event.pointerId,kind:'terrain-move',region:terrainHit.region,target:terrainHit.target,start:position,delta:{dx:0,dy:0}};
        app.canvas.setPointerCapture(event.pointerId);drawOverlay();return;
      }
      callbacks.selection(selected);
      const direct = document.instances.find(item => item.instanceId === selected);
      if (direct && metadata.modules.find(module => module.assetId === direct.assetId)?.kind !== 'strip')
        gesture = { id: event.pointerId, kind: 'move', start: position, current: position, direct, snapToGrid: event.ctrlKey };
      else if(document.assemblyInstances.some(i=>i.instanceId===selected))gesture={id:event.pointerId,kind:'move',start:position,current:position,direct:document.assemblyInstances.find(i=>i.instanceId===selected),assembly:true};
      else viewport.pause = false;
      drawOverlay();
    } else {
      gesture = { id: event.pointerId, kind: 'place', x: event.clientX, y: event.clientY,
        tolerance: event.pointerType === 'touch' ? 10 : 6 };
    }
    if (gesture) app.canvas.setPointerCapture(event.pointerId);
  }, { signal });
  app.canvas.addEventListener('dblclick', event => {
    if (!scene || busy || preview || gesture || tool !== 'curve' || event.button !== 0) return;
    const terrain = scene.layers.find(layer => layer.kind === 'terrain');
    if (!terrain?.visible || hidden.has(terrain.layerId) || locked.has(terrain.layerId)) return;
    event.preventDefault();
    const position = point(event), curves = document.curveTerrains ?? [];
    // Anchors and tangent handles keep their existing selection/drag behavior.
    if (curves.some(curve => curve.points.some(p => Math.hypot(position.x - p.x, position.y - p.y) * viewport.scale.x <= 10))) return;
    const current = curves.find(curve => curve.curveId === curveSelection.curveId), tangent = current && curveHandle(current, curveSelection.pointIndex);
    if (tangent && Math.hypot(position.x - tangent.x, position.y - tangent.y) * viewport.scale.x <= 10) return;
    const hit = findCurveSurface(curves, position, viewport.scale.x, curveSelection.curveId);
    if (hit) callbacks.insertCurvePoint(hit.curve.curveId, hit.x);
  }, { signal });
  app.canvas.addEventListener('pointermove', event => {
    if (!scene) return;
    if (gesture?.id === event.pointerId && (!(event.buttons & 1) || (event.buttons & 2))) {
      event.preventDefault(); cancel(); return;
    }
    if (animationPress?.id === event.pointerId && Math.hypot(event.clientX - animationPress.x, event.clientY - animationPress.y) >= 4)
      animationPress = undefined;
    const position = point(event), gridPosition = cell(position);
    callbacks.cursor(gridPosition);
    if (!gesture || gesture.id !== event.pointerId){
      const box=selected&&tool==='select'&&scalable()?selectionBox(document,scene,metadata.presets,selected):null;
      const corner=box?corners(box).find(([,x,y])=>Math.hypot(position.x-x,position.y-y)<=10/viewport.scale.x):null;
      if(corner)app.canvas.style.cursor=['nw','se'].includes(corner[0])?'nwse-resize':'nesw-resize';else setCursor();return;
    }
    if (gesture.kind === 'place') {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= gesture.tolerance) cancel();
    }
    else if(gesture.kind==='terrain-move'){updateTerrainMove(position);drawOverlay();}
    else if (gesture.kind === 'curve-point' || gesture.kind === 'curve-tangent') { updateCurveGesture(position); drawOverlay(); }
    else if(gesture.kind==='resize'){gesture.rect=resizeFromCorner(gesture.box,gesture.corner,position,gesture.currentScale);drawOverlay();}
    else if (gesture.cells) addStroke(position);
    else { gesture.current = position; gesture.snapToGrid = event.ctrlKey; drawOverlay(); }
  }, { signal });
  app.canvas.addEventListener('pointerup', event => {
    if (preview && animationPress?.id === event.pointerId) {
      const press = animationPress; animationPress = undefined;
      if (!busy && Math.hypot(press.x - event.clientX, press.y - event.clientY) < 4) {
        const position = point(event), { width, height } = scene.defaultCamera.viewport;
        if (gameFrame && (Math.abs(position.x - viewport.center.x) > width / 2
          || Math.abs(position.y - viewport.center.y) > height / 2)) return;
        animationFocus = undefined;
        const result = view.interactAt(position);
        if (result) { needsRender = true; animationFocus = result.nodeId; callbacks.animationState?.(result.state); }
      }
      return;
    }
    if (!gesture || gesture.id !== event.pointerId) return;
    if (event.button !== 0) { cancel(); return; }
    if (gesture.kind === 'place') {
      const position = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < gesture.tolerance && libraryPoint(event);
      cancel();
      if (position) callbacks.place(cell(position), position);
      return;
    }
    if(gesture.kind==='terrain-move')updateTerrainMove(point(event));
    else if (gesture.kind === 'curve-point' || gesture.kind === 'curve-tangent') updateCurveGesture(point(event));
    else if(gesture.kind==='resize')gesture.rect=resizeFromCorner(gesture.box,gesture.corner,point(event),gesture.currentScale);
    else if (gesture.cells) addStroke(point(event));
    else { gesture.current = point(event); gesture.snapToGrid = event.ctrlKey; }
    if (!gesture) return;
    const finished = gesture;
    if(finished.kind==='terrain-move'&&(finished.delta.dx||finished.delta.dy))return submitPreview(finished,()=>callbacks.moveTerrain(finished.target,finished.delta));
    if(finished.kind==='resize'){
      const module=metadata.modules.find(m=>m.assetId===finished.direct.assetId),node=scene.layers.flatMap(l=>l.nodes).find(n=>n.nodeId==='visual/'+finished.direct.instanceId),ratio=node.sourceToLogical.numerator/node.sourceToLogical.denominator/finished.currentScale;
      const difference=finished.rect.scale-finished.currentScale;
      if(difference)return submitPreview(finished,()=>callbacks.resize(finished.direct.instanceId,finished.direct.x+finished.rect.x-finished.box.x+module.anchorPx.x*ratio*difference,finished.direct.y+finished.rect.y-finished.box.y+module.anchorPx.y*ratio*difference,finished.rect.scale));
    }
    if(finished.kind==='move'){
      const { dx, dy } = objectMoveDelta(finished, scene.grid);
      if(finished.assembly){if(dx||dy)return submitPreview(finished,()=>callbacks.moveAssembly(finished.direct,dx/scene.grid.width,dy/scene.grid.height));}
      else{const x=Math.round(finished.direct.x+dx),y=Math.round(finished.direct.y+dy);
        if(x!==finished.direct.x||y!==finished.direct.y)return submitPreview(finished,()=>callbacks.move(finished.direct.instanceId,x,y));}
    }
    if (finished.cells?.size) return submitPreview(finished, () => callbacks.stroke(finished.kind, [...finished.cells.values()]));
    cancel();
    if(finished.grid)callbacks.connectGrid(finished.grid);
    else if (finished.join) callbacks.joinCurves(finished.join);
    else if (finished.kind === 'curve-point' || finished.kind === 'curve-tangent') {
      const original = document.curveTerrains.find(curve => curve.curveId === finished.curve.curveId);
      if (original && finished.curve.points.some((p, i) => p.x !== original.points[i].x || p.y !== original.points[i].y || p.slope !== original.points[i].slope)) callbacks.replaceCurve(finished.curve);
    }
  }, { signal });
  for (const type of ['pointercancel', 'lostpointercapture']) app.canvas.addEventListener(type, event => {
    if (gesture?.id === event.pointerId) cancel();
    if (animationPress?.id === event.pointerId) animationPress = undefined;
  }, { signal });
  window.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || event.isPrimary) return;
    if (gesture) cancel();
    animationPress = undefined;
  }, { signal, capture: true });
  element.addEventListener('dragover',event=>{if(preview||busy||!event.dataTransfer.types.includes('application/x-scene-asset'))return;event.preventDefault();event.dataTransfer.dropEffect='copy';dropPreview={payload:callbacks.dragPayload?.()??{},position:point(event)};drawOverlay();},{signal});
  element.addEventListener('dragleave',event=>{if(!element.contains(event.relatedTarget)){dropPreview=null;drawOverlay();}},{signal});
  element.addEventListener('drop',event=>{if(preview||busy)return;event.preventDefault();dropPreview=null;drawOverlay();try{callbacks.drop(JSON.parse(event.dataTransfer.getData('application/x-scene-asset')),point(event));}catch{callbacks.cancel('无法放置这个素材。');}},{signal});
  window.addEventListener('blur', cancel, { signal });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) cancel(); }, { signal });
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
    if (event.key !== 'Control' || gesture?.kind !== 'move' || gesture.assembly || gesture.snapToGrid === event.ctrlKey) return;
    gesture.snapToGrid = event.ctrlKey;
    drawOverlay();
  }, { signal });
  document = null;
  viewport.on('moved', cameraChanged); viewport.on('zoomed', cameraChanged);
  const resize = new ResizeObserver(() => {
    const center = { x: viewport.center.x, y: viewport.center.y };
    framing = true;
    try {
      app.renderer.resize(element.clientWidth, element.clientHeight);
      viewport.resize(app.screen.width, app.screen.height, scene?.worldBounds.width, scene?.worldBounds.height);
      viewport.moveCenter(center.x, center.y);
    } finally { framing = false; }
    cameraChanged();
  });
  resize.observe(element);
  function home() {
    const camera = scene.defaultCamera;
    viewport.setZoom(Math.min(app.screen.width / (camera.viewport.width + 96), app.screen.height / (camera.viewport.height + 120)) * camera.scale, true);
    viewport.moveCenter(camera.center.x, camera.center.y); cameraChanged();
  }
  return {
    libraryPoint,
    canSyncModules: () => !gesture && !pending,
    async addModules(modules, animationAtlases) {
      const added = await loadModuleTextures(modules.filter(module => !textures.has(module.assetId)), module => loadTexture(module.url));
      await addAnimationAtlases(animationAtlases);
      for (const [id, texture] of added) textures.set(id, texture);
    },
    previewLibraryDrop(payload,event){const position=libraryPoint(event);dropPreview=position?{payload,position}:null;drawOverlay();return position;},
    clearDrop(){dropPreview=null;drawOverlay();},
    frameSelection(id){const box=selectionBox(document,scene,metadata.presets,id);if(!box)return;viewport.setZoom(Math.min(4,Math.min(app.screen.width/(box.width+128),app.screen.height/(box.height+128))),true);viewport.moveCenter(box.x+box.width/2,box.y+box.height/2);cameraChanged();},
    frameCurve(curveId) {
      const curve = scene.curveTerrains?.find(item => item.curveId === curveId); if (!curve) return;
      const bounds = scene.mixedTerrains?.find(patch=>patch.source.curveIds.includes(curveId))?.bounds??curve.bounds;
      viewport.setZoom(Math.min(app.screen.width / (bounds.width + 128), app.screen.height / (bounds.height + 160)), true);
      viewport.moveCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); cameraChanged();
    },
    async setTerrainAppearance(next) {
      if (!['fixture', 'study'].includes(next) || (next === 'study' && !metadata.terrainPreview)) throw new Error('地形试样未配置。');
      cancel();
      if (next === 'study' && !terrainTextures) {
        const loaded = await Promise.all(metadata.terrainPreview.modules.map(async module => {
          const texture = await loadTexture(module.url); texture.source.scaleMode = 'nearest';
          return [module.key, texture];
        }));
        const fields = await Promise.all(Object.entries(metadata.terrainPreview.materialFields).map(async ([kind, item]) => {
          const texture = await loadTexture(item.url); texture.source.style.addressModeU = 'repeat';
          texture.source.style.addressModeV = kind === 'body' ? 'repeat' : 'clamp-to-edge';
          texture.source.scaleMode = 'linear'; return [kind, texture];
        }));
        terrainTextures = new Map(loaded); curveMaterials = Object.fromEntries(fields);
      }
      const previous = terrainAppearance; terrainAppearance = next;
      try { if (scene) { view.update(scene); cameraChanged(); } }
      catch (error) { terrainAppearance = previous; throw error; }
      element.dataset.terrainAppearance = terrainAppearance;
    },
    update(nextScene, nextDocument) {
      cancel({clearPending:true}); scene = nextScene; document = nextDocument;
      regions=terrainRegions(document,{grid:scene.grid,presets:metadata.presets,terrainSkins:scene.terrainSkins});
      gridTargets=gridConnectionTargets(scene);
      viewport.resize(app.screen.width, app.screen.height, scene.worldBounds.width, scene.worldBounds.height);
      const bounds = scene.worldBounds;
      mapBackdrop.clear().rect(bounds.x, bounds.y, bounds.width, bounds.height).fill(0x1d2b3b);
      view.update(scene);
      for (const [sha256, url] of atlasUrls) if (!Object.hasOwn(metadata.animationAtlases ?? {}, sha256)) {
        atlasUrls.delete(sha256); atlasTextures.delete(sha256); loadedTextureUrls.delete(url);
        void Assets.unload(url);
      }
      cameraChanged();
    },
    updateObjects(nextScene, nextDocument, nodes) {
      cancel({clearPending:true});
      scene = nextScene; document = nextDocument;
      view.updateObjects(scene, nodes);
      cameraChanged();
    },
    home,
    previewAppearance(id, appearance) { view.previewAppearance('visual/' + id, appearance); needsRender = true; },
    fit() {
      const bounds = scene.worldBounds;
      viewport.setZoom(Math.min(app.screen.width / (bounds.width + 128), app.screen.height / (bounds.height + 128)), true);
      viewport.moveCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); cameraChanged();
    },
    zoom(factor) { viewport.setZoom(Math.max(.08, Math.min(4, viewport.scale.x * factor)), true); cameraChanged(); },
    jump(x, y) { viewport.moveCenter(x, y); cameraChanged(); },
    controls(options) {
      cancel();
      const wasPreview = preview;
      ({ tool = tool, preview = preview, gameFrame = gameFrame, showGrid = showGrid, showCollision = showCollision, busy = busy, hidden = hidden,hiddenObjects=hiddenObjects,locked=locked, selected = selected, curveSelection = curveSelection,terrainSelection=terrainSelection } = options);
      const isFramed = preview && gameFrame;
      if (preview !== wasPreview) { animationPress = undefined; animationFocus = undefined; view.resetAnimations(); }
      if (preview && !wasPreview) {editCamera = { center: { x: viewport.center.x, y: viewport.center.y }, scale: viewport.scale.x };viewport.moveCenter(scene.defaultCamera.center.x,scene.defaultCamera.center.y);}
      viewport.plugins[isFramed ? 'pause' : 'resume']('wheel');
      if (wasPreview && !preview && editCamera) {
        viewport.setZoom(editCamera.scale, true); viewport.moveCenter(editCamera.center.x, editCamera.center.y); editCamera = null;
      }
      viewport.pause = busy;
      viewport.plugins.remove('drag'); viewport.drag({ mouseButtons: tool === 'pan' || preview ? 'all' : 'right-middle' });
      view.setHiddenLayers(hidden);
      view.setHiddenNodes([...hiddenObjects].map(id=>'visual/'+id));
      setCursor(); cameraChanged();
    },
    destroy() {
      cancel({clearPending:true}); abort.abort(); resize.disconnect();dropHint.remove();
      viewport.off('moved', cameraChanged); viewport.off('zoomed', cameraChanged);
      view.destroy(); viewport.plugins.removeAll(); viewport.destroy({ children: true });
      app.destroy({ removeView: true }, { children: true });
      void Assets.unload([...loadedTextureUrls]);
      loadedTextureUrls.clear();
    },
  };
}
