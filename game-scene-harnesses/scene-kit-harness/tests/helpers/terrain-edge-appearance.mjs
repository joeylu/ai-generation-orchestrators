import {TERRAIN_EDGE_POLICY,ENGINEERED_CITY_TERRAIN_EDGE_POLICY,TERRAIN_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY,
 TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,TERRAIN_REFERENCE_DEFINED_COVER_POLICY,
 TERRAIN_EDGE_ROLES,TERRAIN_PERIMETER_ROLES,compileTerrainEdgeSource} from '../../src/generation/terrain-edge-source.mjs';
import {hash,jsonBytes} from '../../src/generation/common.mjs';

export const sceneRuleSentinels=[
 'SCENE_ONLY_TWO_LEDGES: draw two side ledges and a central floating platform.',
 'SCENE_ONLY_FOREGROUND: two dark foreground sponge groups are mandatory.',
 'SCENE_ONLY_BACKDROP: add the distant arches, a rear chasm and a full water background.'
];
export const appearance={format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules:[
 'Crisp hand-painted broad grey-jade stone faces with restrained local texture.',
 'Keep matching native material feature scale and soft upper-left illumination.',
 'Preserve the requested local pale coral-sand or bare stone termination according to the single boundary brief.'
]};
export function edgeAppearanceFixture(){
 const d=n=>n.repeat(64),spec=d('a'),style=d('b'),cap=d('c'),ref=d('d'),target=d('e'),material=d('f'),raw=d('1'),base=d('2'),refRaw=d('3');
 const recipe={planId:'edge.fixture',parents:[],stage:'terrain-edge-source',specSha256:spec,styleSha256:style,capabilitiesSha256:cap,
  referencePlans:[ref],inventoryRefs:[],assetId:'edge.left',targetSha256:target,baseBatchSha256:base,materialPlanSha256:material,
  materialRawSha256:raw,policySha256:TERRAIN_EDGE_POLICY.sha256,edgeRole:'left-wall',subjectBrief:{content:'One compact local sea-worn stone boundary.',exclusions:['Independent props']}};
 const state={activeSpec:spec,activeStyle:style,designs:new Map([[spec,{format:'ai_scene_spec_v3'}],
  [style,{format:'ai_scene_style_v2',name:'fixture-painted-stone',rules:['Preserve local color.',...sceneRuleSentinels]}]]),
  capabilities:new Map([[cap,{imageToImage:true,transparentBackground:true,maxInputImages:2,maxWidth:4096,maxHeight:4096}]]),
  plans:new Map([[ref,{status:'accepted',plan:{sha256:ref,recipe:{specSha256:spec,styleSha256:style},designReviews:[]},
   result:{rawSha256:refRaw,technical:{image:{sha256:refRaw,byteLength:16,pixelSize:{width:1024,height:576}}}},
   reconstructionTarget:{sha256:target,acceptedPacketSha256:d('4'),humanReceiptSha256:d('5')}}],
   [material,{status:'pending-visual-review',plan:{sha256:material,format:'ai_scene_generation_plan_v27',recipe:{targetSha256:target},
    instanceBinding:{role:'material'},referenceEvidence:[{rawSha256:refRaw}]},result:{rawSha256:raw,
    technical:{status:'pass',sha256:d('6'),image:{sha256:raw,byteLength:24,pixelSize:{width:1024,height:512}}}}}]]),
  batches:new Map([[base,{format:'ai_scene_coherent_source_batch_v2',sha256:base,referencePlanSha256:ref,planSha256s:[material]}]])};
 return {state,recipe};
}
export function appearanceCases(){
 const native={coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1'};
 return [
  ['legacy-natural',TERRAIN_EDGE_POLICY,{},TERRAIN_EDGE_ROLES],
  ['legacy-city',ENGINEERED_CITY_TERRAIN_EDGE_POLICY,{surfaceFamily:'engineered-city'},TERRAIN_EDGE_ROLES],
  ['perimeter-natural',TERRAIN_PERIMETER_POLICY,{coverageProfile:'full-perimeter-v1'},TERRAIN_PERIMETER_ROLES],
  ['perimeter-city',ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY,{coverageProfile:'full-perimeter-v1',surfaceFamily:'engineered-city'},TERRAIN_PERIMETER_ROLES],
  ['native-natural',TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,native,TERRAIN_PERIMETER_ROLES],
  ['native-city',ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,{...native,surfaceFamily:'engineered-city'},TERRAIN_PERIMETER_ROLES],
  ['reference-cover',TERRAIN_REFERENCE_DEFINED_COVER_POLICY,{...native,naturalSurfaceProfile:'reference-defined-cover-v1'},TERRAIN_PERIMETER_ROLES]
 ].flatMap(([name,policy,extra,roles])=>roles.map(role=>({id:name+'.'+role,policy,extra,role})));
}
export function legacyAppearanceFingerprints(){
 const f=edgeAppearanceFixture();
 const rows=appearanceCases().map(c=>{const p=compileTerrainEdgeSource(f.state,{...f.recipe,planId:c.id,assetId:c.id,policySha256:c.policy.sha256,...c.extra,edgeRole:c.role});
  return {id:c.id,planSha256:p.sha256,promptSha256:hash(Buffer.from(p.request.prompt))};});
 return {rows,aggregateSha256:hash(jsonBytes(rows))};
}
