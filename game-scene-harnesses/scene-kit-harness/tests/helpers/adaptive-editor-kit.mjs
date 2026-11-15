import {join} from 'node:path';
import * as flow from '../../src/generation/index.mjs';
import {buildTerrainEdgeDelivery} from '../../src/terrain-edge-pipeline.mjs';
import {loadSceneKit} from '../../src/kit.mjs';
import {setupBottomDelivery,bottomSideControls,bottomFixture} from './terrain-bottom-delivery.mjs';
import {receiveEdgeFixture} from './terrain-edge-delivery.mjs';
import {decision} from './generation.mjs';

// A real public compiler/delivery with synthetic PNG returns only. Editor
// atomicity tests need render-budget failures that structural analysis accepts.
export function adaptiveEditorKit(t){
  const f=setupBottomDelivery(t,{receiveSides:false}),side=bottomSideControls(f),bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]),
    batch=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'editor.adaptive.full',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
      coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
      items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'editor.adaptive.'+i,role,content:'One isolated synthetic perimeter role '+role+'.',exclusions:['Independent objects']}))});
  for(const item of [side.left.wall,side.right.wall])item.repeatY.from=144;
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('editor.adaptive.compute',batch.sha256,'approve-compute'));
  for(const plan of batch.planSha256s)receiveEdgeFixture(f.workflow,plan,raws.get(flow.getGenerationPlan(f.workflow,plan).recipe.edgeRole));
  const options={...f.deliveryOptions,batchSha256:batch.sha256,controls:{...side,bottom:{...bottom.controls,
    nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:'native-bottom-adaptive-coverage-v2'}},
    output:join(f.parent,'adaptive-editor-delivery')};
  buildTerrainEdgeDelivery(options);const root=join(options.output,'candidate/kit');return {...f,root,handle:loadSceneKit(root)};
}
