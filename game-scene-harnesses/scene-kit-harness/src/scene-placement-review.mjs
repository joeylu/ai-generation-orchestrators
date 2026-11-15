import { inspectPng } from './png.mjs';
import { check, digest, exact, hash, id, isDigest, seal } from './generation/common.mjs';
import { instanceOpacity } from './instance-appearance.mjs';

const STEPS = 16, WORK_LIMIT = 4194304;
const round = n => Math.round(n * 1e6) / 1e6;
const inside = ([x, y, w, h], px, py) => px >= x && py >= y && px < x + w && py < y + h;
const rectangle = r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)
  && r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0;

function terrainIndex(scene, order) {
  const bins = new Map(), cells = new Set();
  let work = 0;
  for (const terrain of [...(scene.gridTerrains ?? []), ...(scene.curveTerrains ?? [])]) {
    const layer = order.get(terrain.layerId);
    if (!layer?.visible) continue;
    for (const cell of terrain.source?.gridCells ?? []) cells.add(`${terrain.layerId}/${cell.x},${cell.y}`);
    const {positions, indices} = terrain.body;
    for (let i = 0; i < indices.length; i += 3) {
      const points = indices.slice(i, i + 3).map(n => [positions[2*n], positions[2*n + 1]]);
      const [[ax,ay],[bx,by],[cx,cy]] = points;
      if (Math.abs((bx-ax)*(cy-ay)-(by-ay)*(cx-ax)) < 1e-10) continue;
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      for (let x = Math.floor(Math.min(...xs)/64); x <= Math.floor(Math.max(...xs)/64); x++) {
        for (let y = Math.floor(Math.min(...ys)/64); y <= Math.floor(Math.max(...ys)/64); y++) {
          check(++work <= WORK_LIMIT, 'PLACEMENT_TERRAIN_BUDGET');
          const key = `${x},${y}`;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push({points, layer});
        }
      }
    }
  }
  return {cells, covered(x, y, behind) {
    const cross = ([ax, ay], [bx, by]) => (bx-ax)*(y-ay) - (by-ay)*(x-ax);
    let front;
    for (const {points:[a,b,c], layer} of bins.get(`${Math.floor(x/64)},${Math.floor(y/64)}`) ?? []) {
      check(++work <= WORK_LIMIT, 'PLACEMENT_TERRAIN_BUDGET');
      if (layer.index < behind || front && layer.index <= front.index) continue;
      const values = [cross(a,b),cross(b,c),cross(c,a)];
      if (Math.min(...values) >= -1e-8 || Math.max(...values) <= 1e-8) front=layer;
    }
    return front;
  }};
}

// Samples native feature alpha projected into the final default camera. For
// supported shared terrain the body is opaque and the cap stays inside it.
// This is a placement check; it does not identify features or assess artwork.
export function reviewScenePlacement(scene, observations, readAsset) {
  check(!scene.terrainMaterial?.edges && !scene.terrainMaterial?.bottomEdges
    && !scene.mixedTerrains?.length
    && (scene.terrainSharedField || !(scene.curveTerrains?.length || scene.gridTerrains?.length)), 'PLACEMENT_UNSUPPORTED_TERRAIN');
  check(Array.isArray(observations) && observations.length >= 1 && observations.length <= 16, 'PLACEMENT_OBSERVATIONS');
  const layers = scene.layers.map((layer,index) => ({...layer,index}));
  const order = new Map(layers.map(layer => [layer.layerId,layer]));
  const terrain = terrainIndex(scene, order);
  const nodes = layers.flatMap(layer => layer.nodes.filter(n => !n.cell
    || !terrain.cells.has(`${layer.layerId}/${n.cell.x},${n.cell.y}`)).map(node => ({node,layer})));
  const decoded = new Map(), seen = new Set(), results = [];
  let work = 0;
  const bitmap = source => {
    if (!decoded.has(source.sha256)) {
      const bytes = readAsset(source.path);
      check(bytes instanceof Uint8Array && hash(bytes) === source.sha256, 'PLACEMENT_SOURCE');
      decoded.set(source.sha256, inspectPng(Buffer.from(bytes), {includePixels:true,allowCabx:true,allowHiddenRgb:true}));
    }
    return decoded.get(source.sha256);
  };
  function alpha(node, x, y) {
    const ux = (x-node.position.x)/node.size.width, sy = (y-node.position.y)/node.size.height;
    const sx = node.kind === 'repeat-x' ? ux-Math.floor(ux) : ux;
    if (!inside([0,0,1,1],sx,sy)) return 0;
    const img = bitmap(node.source);
    return img.rgba[(Math.floor(sy*img.height)*img.width+Math.floor(sx*img.width))*4+3]/255*instanceOpacity(node);
  }
  const {center, viewport, scale} = scene.defaultCamera;
  const width = viewport.width/scale, height = viewport.height/scale;
  const left = center.x-width/2, top = center.y-height/2;
  for (const observation of observations) {
    const hasFramingPolicy = Object.hasOwn(observation ?? {}, 'framingPolicy');
    exact(observation,['observationId','instanceId','sourceSha256','sourceRegion','frameRegion','minimumVisibleFraction',
      ...(hasFramingPolicy ? ['framingPolicy'] : [])]);
    const {observationId,instanceId,sourceSha256,sourceRegion,frameRegion,minimumVisibleFraction,framingPolicy} = observation;
    check(!hasFramingPolicy || framingPolicy === 'report-only', 'PLACEMENT_FRAMING_POLICY');
    const reportOnly = framingPolicy === 'report-only';
    id(observationId); id(instanceId);
    check(!seen.has(observationId) && isDigest(sourceSha256), 'PLACEMENT_IDENTITY');
    seen.add(observationId);
    check(rectangle(sourceRegion) && sourceRegion.every(Number.isSafeInteger) && rectangle(frameRegion)
      && frameRegion[0]+frameRegion[2] <= 1 && frameRegion[1]+frameRegion[3] <= 1
      && Number.isFinite(minimumVisibleFraction) && minimumVisibleFraction > 0 && minimumVisibleFraction <= 1, 'PLACEMENT_REGION');
    const index = nodes.findIndex(({node}) => node.nodeId === `visual/${instanceId}`);
    const target = nodes[index];
    check(target?.node.kind === 'sprite' && target.node.source.sha256 === sourceSha256, 'PLACEMENT_TARGET_SOURCE');
    const {node,layer} = target, img = bitmap(node.source);
    const [rx,ry,rw,rh] = sourceRegion;
    check(rx+rw <= img.width && ry+rh <= img.height, 'PLACEMENT_REGION');
    const above = nodes.slice(index+1).filter(n => n.layer.visible).reverse();
    let total = 0, framed = 0, inView = 0, visible = 0;
    const blockers = new Map();
    const block = (layerId,weight) => blockers.set(layerId,(blockers.get(layerId) ?? 0)+weight);
    for (let j = 0; j < Math.min(STEPS,rh); j++) for (let i = 0; i < Math.min(STEPS,rw); i++) {
      const sx = rx+(i+.5)*rw/Math.min(STEPS,rw), sy = ry+(j+.5)*rh/Math.min(STEPS,rh);
      const weight = img.rgba[(Math.floor(sy)*img.width+Math.floor(sx))*4+3]/255;
      total += weight;
      if (weight === 0) continue;
      const x = node.position.x+sx/img.width*node.size.width, y = node.position.y+sy/img.height*node.size.height;
      const frameX = (x-left)/width, frameY = (y-top)/height;
      const inReferenceRegion = inside(frameRegion,frameX,frameY);
      if (inReferenceRegion) framed += weight;
      if (reportOnly ? !inside([0,0,1,1],frameX,frameY) : !inReferenceRegion) continue;
      inView += weight;
      if (!layer.visible) continue;
      let transmission = instanceOpacity(node);
      const solid = terrain.covered(x,y,layer.index);
      for (const front of above) {
        if (solid && front.layer.index <= solid.index) break;
        check(++work <= WORK_LIMIT,'PLACEMENT_SPRITE_BUDGET');
        const opacity = alpha(front.node,x,y);
        if (opacity > 0) block(front.layer.layerId,weight*transmission*opacity);
        transmission *= 1-opacity;
        if (transmission === 0) break;
      }
      if (solid) {
        if (transmission > 0) block(solid.layerId,weight*transmission);
        continue;
      }
      visible += weight*transmission;
    }
    check(total > 0, 'PLACEMENT_EMPTY_FEATURE');
    const denominator = reportOnly ? inView : total;
    const status = denominator === 0 ? 'outside-frame'
      : visible/denominator+1e-9 >= minimumVisibleFraction ? 'pass' : 'blocked';
    results.push({observationId,instanceId,framedFraction:round(framed/total),visibleFraction:round(visible/total),
      ...(reportOnly ? {framingPolicy,inFrameFraction:round(inView/total),
        inFrameVisibleFraction:inView > 0 ? round(visible/inView) : null} : {}),
      minimumVisibleFraction,status,
      blockedBy:[...blockers].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([layerId,value]) => ({layerId,fraction:round(value/denominator)}))});
  }
  return seal({format:'ai_scene_placement_review_v1',kitSha256:scene.source.kitSha256,authorSha256:scene.source.authorSha256,
    compiledSha256:scene.contentSha256,observationsSha256:digest(observations),results,
    status:results.some(result => result.status === 'blocked')?'blocked':'pass',visualAcceptance:'not-assessed'});
}
