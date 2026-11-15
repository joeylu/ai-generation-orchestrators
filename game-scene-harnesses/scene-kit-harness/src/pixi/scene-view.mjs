import { Container, Sprite, TilingSprite, Mesh, MeshGeometry, Rectangle, Texture } from 'pixi.js';
import { layerOffset, repeatCoverage } from './projection.mjs';
import { hasDrawableTriangles } from './mesh-geometry.mjs';
import { appearanceMatrix, instanceOpacity } from '../instance-appearance.mjs';
import { createAppearanceFilter } from './appearance-filter.mjs';
import { animationFrameRect, createEnvironmentAnimationPlayer, environmentAnimationTransform } from '../environment-animation.mjs';
import {validateMeshCoverage} from '../mesh-coverage.mjs';
import {attachVertexCoverage,createVertexCoverageShader} from './coverage-mesh.mjs';
export { terrainStudyTextureKey } from './terrain-appearance.mjs';
export { loadTerrainMaterial } from './materials.mjs';

// Consume verified compiled scenes or explicit read-only terrain diagnostic
// frames. Display support never makes a diagnostic frame an exportable scene.
// The host owns texture loading and camera/input; this adapter never fetches
// files or serializes author data.
export function createSceneView({ resolveTexture, resolveNodeTexture, resolveCurveMaterial, resolveAnimationAtlas, onAnimationState }) {
  const root = new Container({ label: 'scene-kit-world', eventMode: 'none' });
  let scene, layers = [], repeats = [], hidden = new Set(), hiddenNodes=new Set(),sprites=[],previews=new Map(),terrainPreviews=new Map(),meshes=[], geometries = [];
  let animated = new Map(), animationTextures = [];
  const coverageShaders=new Map(),coverageGeometries=new Set();
  function disposeCoverageResources(){
    geometries.forEach(geometry=>geometry.destroy(coverageGeometries.has(geometry)));geometries=[];coverageGeometries.clear();
    coverageShaders.forEach(shader=>shader.destroy());coverageShaders.clear();
  }
  function prepareAnimation(animation) {
    const { pixelSize, anchorPx } = animation;
    return new Map(animation.states.filter(state => state.clip).map(({ id, clip }) => {
      const atlas = resolveAnimationAtlas(clip.source);
      if (!atlas) throw new Error('Animation texture is unavailable');
      const { columns, rows } = clip;
      return [id, Array.from({ length: columns * rows }, (_, index) => {
        const { x, y, width, height } = animationFrameRect(index, atlas.width, atlas.height, columns, rows);
        const placement = environmentAnimationTransform({ pixelSize, anchorPx }, clip, index);
        // All states keep the static module's origin and apparent scale.
        return new Texture({ source: atlas.source, frame: new Rectangle(x, y, width, height),
          orig: new Rectangle(0, 0, pixelSize.width, pixelSize.height),
          trim: new Rectangle(placement.x, placement.y, width * placement.scale, height * placement.scale) });
      })];
    }));
  }
  function displayAnimation(item) {
    const { player, sprite, frames, still } = item;
    sprite.texture = frames.get(player.state.id)?.[player.frame] ?? still;
    if (item.stateId !== player.state.id) {
      item.stateId = player.state.id;
      onAnimationState?.(item.node.nodeId, player.state);
    }
  }
  function interact(nodeId) {
    const item = animated.get(nodeId);
    if (!item?.player.interact()) return false;
    displayAnimation(item);
    return true;
  }
  function setAppearance(item, appearance) {
    const {sprite,node} = item, matrix = appearanceMatrix(appearance);
    sprite.alpha = instanceOpacity(node, appearance);
    if (matrix && item.filter) {
      const uniforms = item.filter.resources.appearanceUniforms.uniforms;
      [uniforms.uRed, uniforms.uGreen, uniforms.uBlue] = matrix;
    } else if (matrix) {
      item.filter = createAppearanceFilter(matrix);
      sprite.filters = [item.filter];
    } else if (item.filter) {
      sprite.filters = null;
      item.filter.destroy();
      item.filter = null;
    }
  }
  function disposeAppearanceFilters() { for (const item of sprites) item.filter?.destroy(); }
  function setHiddenNodes(ids){hiddenNodes=new Set(ids);for(const {sprite,node}of sprites)sprite.visible=![...hiddenNodes].some(id=>node.nodeId===id||node.nodeId.startsWith(id+'/'));}
  function resetPreview(){for(const [sprite,p]of previews){sprite.position.set(p.x,p.y);sprite.width=p.width;sprite.height=p.height;}previews.clear();for(const [item,p]of terrainPreviews)item.position.set(p.x,p.y);terrainPreviews.clear();}
  function setHiddenLayers(next) {
    hidden = new Set(next);
    for (const { container, layer } of layers) container.visible = layer.visible && !hidden.has(layer.layerId);
  }
  function setCamera({ center, visible, preview = false }) {
    if (!scene) return;
    for (const { container, layer } of layers) {
      const offset = layerOffset(center, scene.defaultCamera.center, layer.parallax, preview);
      container.position.set(offset.x, offset.y);
    }
    for (const { sprite, node, container } of repeats) {
      const coverage = repeatCoverage(node, visible, container.position);
      sprite.x = coverage.x; sprite.width = coverage.width; sprite.tilePosition.x = coverage.tileX;
    }
  }
  return {
    root,
    update(next) {
      if (!['ai_scene_compiled_v1', 'ai_scene_compiled_v2','ai_scene_compiled_v3','ai_scene_compiled_v4','ai_scene_compiled_v5','ai_scene_compiled_v6','ai_scene_compiled_v7','ai_scene_compiled_v8','ai_scene_terrain_render_diagnostic_frame_v1'].includes(next.format)) throw new Error('Unsupported compiled scene');
      const patches=next.mixedTerrains??[];
      const patchCells=new Set(patches.flatMap(patch=>patch.source.gridCells.map(c=>`${c.x},${c.y}`)));
      const gridTerrains=next.gridTerrains??[];
      const meshCells=new Set(gridTerrains.flatMap(terrain=>terrain.source.gridCells.map(c=>`${c.x},${c.y}`)));
      const patchCurves=new Set(patches.flatMap(patch=>patch.source.curveIds));
      const replaced=node=>node.cell&&(patchCells.has(`${node.cell.x},${node.cell.y}`)||meshCells.has(`${node.cell.x},${node.cell.y}`));
      // Resolve the complete texture set first, so a missing resource leaves the old view intact.
      const resolved = new Map(next.layers.flatMap(layer => layer.nodes).filter(node=>!replaced(node)).map(node => [node,
        resolveNodeTexture?.(node) ?? resolveTexture(node.assetId, node.source)]));
      if ([...resolved.values()].some(texture => !texture)) throw new Error('Scene texture is unavailable');
      const animations = resolveAnimationAtlas ? Object.entries(next.environmentAnimations ?? {}) : [];
      for (const [, animation] of animations) for (const { clip } of animation.states)
        if (clip && !resolveAnimationAtlas(clip.source)) throw new Error('Animation texture is unavailable');
      const curves = [...gridTerrains,...(next.curveTerrains??[]).filter(curve=>!patchCurves.has(curve.curveId)),...patches];
      const linearContract=next.terrainMaterial?.stepSurface?.profile==='native-lip-linear-step-end-v2'
        &&next.terrainMaterial.stepSurface.format==='ai_scene_terrain_step_surface_v2'
        &&next.terrainMaterial.stepSurface.endFade?.compiledFormat==='ai_scene_compiled_v8';
      if(next.format==='ai_scene_compiled_v8'&&!linearContract)throw Error('Missing linear coverage contract');
      for(const curve of curves)for(const data of [curve.body,curve.cap,...(curve.capBands??[]),...(curve.topCoverBands??[]),
        ...(curve.edgeMeshes??[]),...(curve.nativeTopCornerMeshes??[]),...(curve.fieldBoundaryBands??[])])
        if(data&&validateMeshCoverage(data))throw Error('Unsupported vertex coverage location');
      for(const curve of curves)for(const data of curve.cornerMeshes??[])if(validateMeshCoverage(data)){
        if(!linearContract||!['ai_scene_compiled_v8','ai_scene_terrain_render_diagnostic_frame_v1'].includes(next.format)||data.materialKind!=='cap')throw Error('Unsupported vertex coverage contract');
      }
      const curveMaterials = new Map(curves.map(curve => [curve, resolveCurveMaterial?.(curve) ?? null]));
      if (next.terrainMaterial && curves.some(curve => !curveMaterials.get(curve))) throw new Error('Compiled terrain material is unavailable');
      for (const material of curveMaterials.values()) if (material && (!material.body || !material.cap)) throw new Error('Curve material is unavailable');
      for (const curve of curves) for (const edge of [...(curve.edgeMeshes ?? []),...(curve.nativeTopCornerMeshes??[])]) {
        if (!curveMaterials.get(curve)?.edges?.[edge.materialKey]) throw new Error('Curve side material is unavailable');
      }
      scene = next;
      disposeAppearanceFilters();
      previews.clear();terrainPreviews.clear();sprites=[];meshes=[];root.removeChildren().forEach(child => child.destroy({ children: true })); layers = []; repeats = [];
      animationTextures.forEach(texture => texture.destroy(false));
      const prepared = new Map(animations.map(([assetId, animation]) => [assetId, { animation, frames: prepareAnimation(animation) }]));
      animationTextures = [...prepared.values()].flatMap(({ frames }) => [...frames.values()].flat());
      animated = new Map();
      disposeCoverageResources();
      for (const layer of scene.layers) {
        const container = new Container({ label: layer.layerId, eventMode: 'none' });
        layers.push({ container, layer }); root.addChild(container);
        for (const node of layer.nodes) {
          if(replaced(node))continue;
          const texture = resolved.get(node);
          const sprite = node.kind === 'repeat-x' ? new TilingSprite({ texture, width: 1, height: node.size.height }) : new Sprite({ texture });
          sprite.position.set(node.position.x, node.position.y);
          if (node.kind === 'repeat-x') {
            sprite.tileScale.set(node.size.width / texture.width, node.size.height / texture.height);
            repeats.push({ sprite, node, container });
          } else { sprite.width = node.size.width; sprite.height = node.size.height; }
          if (node.renderStyle) sprite.tint = node.renderStyle.tint;
          container.addChild(sprite);
          const item = {sprite,node};
          setAppearance(item, node.appearance);
          sprites.push(item);
          const clip = prepared.get(node.assetId);
          if (clip) {
            const animatedItem = { ...item, container, frames: clip.frames, still: texture,
              player: createEnvironmentAnimationPlayer(clip.animation) };
            animated.set(node.nodeId, animatedItem);
            displayAnimation(animatedItem);
          }
        }
        for (const curve of curves.filter(curve => curve.layerId === layer.layerId)) {
          const material = curveMaterials.get(curve);
          for (const kind of ['body', 'cap']) {
            if(kind==='cap'&&Array.isArray(curve.topCoverBands))continue;
            for(const data of kind==='cap'&&curve.capBands?curve.capBands:[curve[kind]]){
            if(!hasDrawableTriangles(data))continue;
            const geometry = new MeshGeometry({ positions: new Float32Array(data.positions),
              uvs: new Float32Array(data.uvs), indices: new Uint32Array(data.indices) });
            const mesh = new Mesh({ geometry, texture: material?.[kind] ?? Texture.WHITE });
            if(data.coverageOpacity!==undefined)mesh.alpha=data.coverageOpacity;
            geometries.push(geometry);
            mesh.label = curve.gridTerrainId ? `grid/${curve.gridTerrainId}/${kind}` : curve.patchId ? `${curve.patchId}/${kind}` : `curve/${curve.curveId}/${kind}`;
            meshes.push({mesh,curve});
            if (!material) mesh.tint = kind === 'body' ? 0x8b765e : 0x91b968;
            else if (next.terrainMaterial?.tint !== undefined) mesh.tint = next.terrainMaterial.tint;
            container.addChild(mesh);
            }
          }
          for (const data of curve.edgeMeshes ?? []) {
            if(!hasDrawableTriangles(data))continue;
            const geometry = new MeshGeometry({ positions: new Float32Array(data.positions), uvs: new Float32Array(data.uvs), indices: new Uint32Array(data.indices) });
            const mesh = new Mesh({ geometry, texture: material.edges[data.materialKey] });
            if (data.coverageOpacity !== undefined) mesh.alpha = data.coverageOpacity;
            geometries.push(geometry); mesh.label = `${curve.gridTerrainId?'grid':'curve'}/${data.edgeId}`;
            meshes.push({ mesh, curve }); container.addChild(mesh);
          }
          for(const data of curve.fieldBoundaryBands??[]){
            if(!hasDrawableTriangles(data))continue;
            const geometry=new MeshGeometry({positions:new Float32Array(data.positions),uvs:new Float32Array(data.uvs),indices:new Uint32Array(data.indices)}),
              mesh=new Mesh({geometry,texture:material.body});
            mesh.alpha=data.coverageOpacity;mesh.tint=data.shadeTint;mesh.label=`shared-field-boundary/${data.direction}`;
            geometries.push(geometry);meshes.push({mesh,curve});container.addChild(mesh);
          }
        }
        // Adaptive lower coverage preserves only cap samples supported by the
        // original solid, after all native roles in this layer have drawn.
        for(const curve of curves.filter(curve=>curve.layerId===layer.layerId))for(const data of curve.topCoverBands??[]){
          if(!hasDrawableTriangles(data))continue;
          const material=curveMaterials.get(curve),geometry=new MeshGeometry({positions:new Float32Array(data.positions),
            uvs:new Float32Array(data.uvs),indices:new Uint32Array(data.indices)});
          const mesh=new Mesh({geometry,texture:material?.cap??Texture.WHITE});
          mesh.alpha=data.coverageOpacity??1;if(next.terrainMaterial?.tint!==undefined)mesh.tint=next.terrainMaterial.tint;
          mesh.label=`supported-top-cover/${curve.gridTerrainId??curve.curveId??curve.patchId}`;
          geometries.push(geometry);meshes.push({mesh,curve});container.addChild(mesh);
        }
        // Native upper corners retain their own transparent silhouette. Move
        // them after the central cap exactly once; no material-field rectangle
        // may fill their artist-authored recesses.
        for(const curve of curves.filter(curve=>curve.layerId===layer.layerId))for(const data of curve.nativeTopCornerMeshes??[]){
          if(!hasDrawableTriangles(data))continue;
          const material=curveMaterials.get(curve),geometry=new MeshGeometry({positions:new Float32Array(data.positions),
            uvs:new Float32Array(data.uvs),indices:new Uint32Array(data.indices)});
          const mesh=new Mesh({geometry,texture:material.edges[data.materialKey]});
          mesh.alpha=data.coverageOpacity??1;mesh.label=`native-top-corner/${data.edgeId}`;
          geometries.push(geometry);meshes.push({mesh,curve});container.addChild(mesh);
        }
        // Concave surface junctions intentionally cover the old wall foot. Draw
        // them only after every body/cap/native side in the same terrain layer.
        for(const curve of curves.filter(curve=>curve.layerId===layer.layerId))for(const data of curve.cornerMeshes??[]){
          if(!hasDrawableTriangles(data))continue;
          const material=curveMaterials.get(curve),geometry=new MeshGeometry({positions:new Float32Array(data.positions),
            uvs:new Float32Array(data.uvs),indices:new Uint32Array(data.indices)});
          const texture=material?.[data.materialKind]??Texture.WHITE,linear=validateMeshCoverage(data);
          if(linear){attachVertexCoverage(geometry,data);coverageGeometries.add(geometry);
            if(!coverageShaders.has(texture))coverageShaders.set(texture,createVertexCoverageShader(texture));}
          const mesh=new Mesh({geometry,texture,...(linear?{shader:coverageShaders.get(texture)}:{})});
          mesh.alpha=data.coverageOpacity??1;mesh.label=`step-corner/${data.cornerId}/${data.materialKind}`;
          geometries.push(geometry);meshes.push({mesh,curve});container.addChild(mesh);
        }
      }
      setHiddenLayers(hidden);
      setHiddenNodes(hiddenNodes);
    },
    // Studio calls this only for a checked patch with the same node identities,
    // ordering, texture sources and terrain geometry.
    updateObjects(next, nodes) {
      const changed = new Map(nodes.map(node => [node.nodeId, node]));
      for (const item of sprites) {
        const node = changed.get(item.node.nodeId);
        if (!node) continue;
        const { sprite } = item;
        item.node = node;
        if (animated.has(node.nodeId)) animated.get(node.nodeId).node = node;
        sprite.position.set(node.position.x, node.position.y);
        if (node.kind === 'repeat-x') {
          sprite.height = node.size.height;
          sprite.tileScale.set(node.size.width / sprite.texture.width, node.size.height / sprite.texture.height);
        } else {
          sprite.width = node.size.width;
          sprite.height = node.size.height;
        }
        sprite.tint = node.renderStyle?.tint ?? 0xffffff;
        setAppearance(item, node.appearance);
      }
      for (const item of repeats) item.node = changed.get(item.node.nodeId) ?? item.node;
      scene = next;
    },
    setHiddenLayers, setHiddenNodes,setCamera,resetPreview,
    advanceAnimations(deltaMs) {
      let changed = false;
      for (const item of animated.values()) {
        const { player } = item, before = player.frame, stateId = player.state.id;
        player.advance(deltaMs);
        if (before !== player.frame || stateId !== player.state.id) {
          displayAnimation(item);
          changed = true;
        }
      }
      return changed;
    },
    resetAnimations() {
      for (const item of animated.values()) { item.player.reset(); displayAnimation(item); }
    },
    interact,
    interactAt(position) {
      for (const [nodeId, { player, sprite, container }] of [...animated].reverse()) {
        if (!player.state.onInteract || !sprite.visible || !container.visible) continue;
        const x = sprite.x + container.x, y = sprite.y + container.y;
        if (position.x >= x && position.x < x + sprite.width && position.y >= y && position.y < y + sprite.height) {
          interact(nodeId);
          return { nodeId, state: player.state };
        }
      }
      return false;
    },
    previewAppearance(nodeId, appearance) {
      const item = sprites.find(item => item.node.nodeId === nodeId);
      if (item) setAppearance(item, appearance ?? item.node.appearance);
    },
    previewTerrain(region,{dx,dy}) {
      const move=item=>{if(!terrainPreviews.has(item))terrainPreviews.set(item,{x:item.x,y:item.y});const p=terrainPreviews.get(item);item.position.set(p.x+dx,p.y+dy);};
      for(const {sprite,node}of sprites)if((node.cell&&region.cellKeys.has(`${node.cell.x},${node.cell.y}`))||region.instanceIds.some(id=>node.nodeId===`visual/${id}`)||region.assemblyIds.some(id=>node.nodeId.startsWith(`visual/${id}/`)))move(sprite);
      for(const {mesh,curve}of meshes)if(region.curveIds.includes(curve.curveId)||curve.source?.curveIds?.some(id=>region.curveIds.includes(id))
        ||curve.source?.gridCells?.some(cell=>region.cellKeys.has(`${cell.x},${cell.y}`)))move(mesh);
    },
    previewTransform(id,change){for(const {sprite,node}of sprites)if(node.nodeId===id||node.nodeId.startsWith(id+'/')){
      if(!previews.has(sprite))previews.set(sprite,{x:sprite.x,y:sprite.y,width:sprite.width,height:sprite.height});const p=previews.get(sprite);
      sprite.position.set(change.x??p.x+(change.dx??0),change.y??p.y+(change.dy??0));sprite.width=change.width??p.width;sprite.height=change.height??p.height;
    }},
    destroy() { disposeAppearanceFilters(); root.destroy({ children: true }); disposeCoverageResources(); layers = []; repeats = []; scene = null;
      animationTextures.forEach(texture => texture.destroy(false)); animationTextures = []; animated.clear(); },
  };
}
