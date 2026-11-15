import {check,exact,isDigest,seal} from './generation/common.mjs';

export const TERRAIN_RENDER_DIAGNOSTIC_GROUPS=Object.freeze([
  'body','surface','upper-corners','walls','bottom','step-corners','body-shading',
]);
export const TERRAIN_RENDER_DIAGNOSTIC_EDGE_ROLES=Object.freeze([
  'left.wall','right.wall','left.corner','right.corner','bottom.edge','bottom.leftCorner','bottom.rightCorner',
]);
const empty=()=>({positions:[],uvs:[],indices:[]});
function edgeGroup(edge){
  if(['left.wall','right.wall'].includes(edge.materialKey))return 'walls';
  if(['left.corner','right.corner'].includes(edge.materialKey))return 'upper-corners';
  if(['bottom.edge','bottom.leftCorner','bottom.rightCorner'].includes(edge.materialKey))return 'bottom';
  check(false,'TERRAIN_DIAGNOSTIC_EDGE','Unknown edge responsibility; do not silently classify it as a bottom edge');
}

// Omit whole compiled draw groups for source-over diagnosis. This is deliberately
// not an author edit, a new kit, a source preparation or a compiled-scene export.
export function createTerrainRenderDiagnostic(compiled,{groups}={}){
  check(Array.isArray(groups)&&groups.length>0&&new Set(groups).size===groups.length
    &&groups.every(g=>TERRAIN_RENDER_DIAGNOSTIC_GROUPS.includes(g)),
  'TERRAIN_DIAGNOSTIC_GROUPS','Choose explicit known terrain draw groups');
  check(/^ai_scene_compiled_v\d+$/.test(compiled?.format)&&isDigest(compiled.contentSha256)
    &&isDigest(compiled.source?.authorSha256)&&compiled.terrainMaterial
    &&Array.isArray(compiled.layers),'TERRAIN_DIAGNOSTIC_SCENE','An indexed compiled terrain scene is required');
  const selected=new Set(groups),scene=structuredClone(compiled);
  for(const layer of scene.layers)layer.nodes=[];
  for(const key of ['gridTerrains','curveTerrains','mixedTerrains'])for(const patch of scene[key]??[]){
    if(!selected.has('body'))patch.body=empty();
    if(!selected.has('surface')){
      patch.cap=empty();
      // Keep absent fields absent: an empty late-cover array has draw-order
      // meaning and must not accidentally suppress a legacy cap.
      for(const field of ['capBands','topCoverBands'])if(Object.hasOwn(patch,field))patch[field]=[];
    }
    patch.edgeMeshes=(patch.edgeMeshes??[]).filter(edge=>selected.has(edgeGroup(edge)));
    if(!selected.has('upper-corners'))patch.nativeTopCornerMeshes=[];
    if(!selected.has('step-corners'))patch.cornerMeshes=[];
    if(!selected.has('body-shading'))patch.fieldBoundaryBands=[];
  }
  const report=seal({format:'ai_scene_terrain_render_diagnostic_v1',
    compiledSha256:compiled.contentSha256,source:structuredClone(compiled.source),
    groups:TERRAIN_RENDER_DIAGNOSTIC_GROUPS.filter(g=>selected.has(g)),
    method:'omit-whole-draw-groups-and-environment-sprites-only',
    retainedGeometry:'unchanged-positions-uvs-indices-opacity-and-order',
    camera:'unchanged',sourceProcessing:'none',actualStudioFrames:false,
    productionKit:false,artAcceptance:'not-assessed',generationCalls:0});
  scene.format='ai_scene_terrain_render_diagnostic_frame_v1';
  delete scene.contentSha256;
  return {scene,report};
}

// Refine an explicit group selection by native source responsibility. Keep both
// early legacy and late native upper corners in the same role, without changing
// any retained mesh, its continuous coverage, or the body/cap draw consumers.
export function createTerrainEdgeRoleDiagnostic(compiled,options){
  exact(options,['groups','edgeRoles']);
  const {groups,edgeRoles}=options;
  check(Array.isArray(edgeRoles)&&new Set(edgeRoles).size===edgeRoles.length
    &&edgeRoles.every(role=>TERRAIN_RENDER_DIAGNOSTIC_EDGE_ROLES.includes(role)),
  'TERRAIN_DIAGNOSTIC_EDGE_ROLES','Choose explicit known native edge roles; an empty list omits all native edges');
  const {scene,report:selection}=createTerrainRenderDiagnostic(compiled,{groups}),selected=new Set(edgeRoles),
    counts=Object.fromEntries(TERRAIN_RENDER_DIAGNOSTIC_EDGE_ROLES.map(role=>[role,{before:0,retained:0,omitted:0}]));
  for(const key of ['gridTerrains','curveTerrains','mixedTerrains']){
    for(const patch of compiled[key]??[])for(const mesh of patch.nativeTopCornerMeshes??[])
      check(['left.corner','right.corner'].includes(mesh.materialKey),'TERRAIN_DIAGNOSTIC_NATIVE_TOP_ROLE','A late native upper corner must declare its exact source role');
    for(const patch of scene[key]??[])for(const field of ['edgeMeshes','nativeTopCornerMeshes'])if(Object.hasOwn(patch,field)){
      patch[field]=patch[field].filter(mesh=>{
        const count=counts[mesh.materialKey];check(count,'TERRAIN_DIAGNOSTIC_EDGE','Unknown native source responsibility');
        const keep=selected.has(mesh.materialKey);count.before++;count[keep?'retained':'omitted']++;return keep;
      });
    }
  }
  return {scene,report:seal({format:'ai_scene_terrain_edge_role_diagnostic_v1',
    compiledSha256:selection.compiledSha256,source:selection.source,selectionSha256:selection.sha256,
    groups:selection.groups,edgeRoles:TERRAIN_RENDER_DIAGNOSTIC_EDGE_ROLES.filter(role=>selected.has(role)),
    nativeMeshesWithinSelectedGroups:counts,method:'omit-whole-native-source-role-meshes-after-group-selection',
    retainedGeometry:'unchanged-positions-uvs-indices-continuous-coverage-and-order',
    otherConsumers:'unchanged-selected-body-cap-step-and-shading',sourceProcessing:'none',camera:'unchanged',
    actualStudioFrames:false,productionKit:false,artAcceptance:'not-assessed',generationCalls:0})};
}

// Counterfactual sampling only: one UV unit is one checked body texture period.
// All consumers of that texture move together, including concave body wedges
// and tinted body-boundary bands. Cap/native sampling and author data stay put.
export function createTerrainBodyPhaseDiagnostic(compiled,{groups,phase}={}){
  exact(phase,['u','v']);
  check([phase.u,phase.v].every(n=>Number.isFinite(n)&&Math.abs(n)<=1),
    'TERRAIN_DIAGNOSTIC_BODY_PHASE','Choose a finite UV offset within one body period per axis');
  const {scene,report:selection}=createTerrainRenderDiagnostic(compiled,{groups}),
    consumers={body:0,bodyShading:0,stepBody:0};
  const shift=(mesh,kind)=>{
    if(!mesh?.indices.length)return;
    check(mesh.uvs.length===mesh.positions.length&&mesh.uvs.every(Number.isFinite),
      'TERRAIN_DIAGNOSTIC_BODY_UVS');
    mesh.uvs=mesh.uvs.map((n,i)=>n+(i%2?phase.v:phase.u));consumers[kind]++;
  };
  for(const key of ['gridTerrains','curveTerrains','mixedTerrains'])for(const patch of scene[key]??[]){
    shift(patch.body,'body');
    for(const band of patch.fieldBoundaryBands??[])shift(band,'bodyShading');
    for(const mesh of patch.cornerMeshes??[]){
      check(['body','cap'].includes(mesh.materialKind),'TERRAIN_DIAGNOSTIC_STEP_MATERIAL');
      if(mesh.materialKind==='body')shift(mesh,'stepBody');
    }
  }
  return {scene,report:seal({format:'ai_scene_terrain_body_phase_diagnostic_v1',
    compiledSha256:selection.compiledSha256,source:selection.source,
    selectionSha256:selection.sha256,groups:selection.groups,phase:{u:phase.u,v:phase.v},
    phaseUnits:'one-checked-body-texture-period-per-axis',consumers,
    method:'offset-all-retained-body-material-uvs-only',
    retainedGeometry:'unchanged-positions-indices-opacity-and-order',
    otherSampling:'unchanged-cap-and-native-uvs',sourceProcessing:'none',camera:'unchanged',
    originalMaterialRegistration:'not-certified-by-this-counterfactual',
    actualStudioFrames:false,productionKit:false,artAcceptance:'not-assessed',generationCalls:0})};
}
