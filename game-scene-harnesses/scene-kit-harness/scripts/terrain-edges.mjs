import {readSelectedFile,parseJson} from '../src/files.mjs';
import {check,seal,hash,jsonBytes} from '../src/generation/common.mjs';
import {existsSync} from 'node:fs';
import {writeProofBundle,verifyProofBundle} from '../src/terrain-proof/bundle.mjs';
import * as flow from '../src/generation/index.mjs';
import {forkCompletedWorkflow} from '../src/generation/workflow-fork.mjs';
import {inspectTerrainEdgeBatch,reserveTerrainEdgeExchange,receiveTerrainEdgeExchange,stopTerrainEdgeExchange,runTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {prepareTerrainEdgeComputeReview,buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery,exportTerrainEdgeCanvasGutterReview,applyTerrainEdgeCanvasGutterReview} from '../src/terrain-edge-pipeline.mjs';
import {buildTerrainBottomEdgeDelivery,verifyTerrainBottomEdgeDelivery} from '../src/terrain-bottom-edge-pipeline.mjs';
import {upgradeTerrainBrushKit,verifyTerrainBrushKit} from '../src/grid-terrain-upgrade.mjs';
import {upgradeTerrainEdgeJunctionKit,verifyTerrainEdgeJunctionKit} from '../src/terrain-edge-junction-upgrade.mjs';
import {upgradeTerrainUnionMaterialKit,verifyTerrainUnionMaterialKit} from '../src/terrain-union-material-upgrade.mjs';
import {upgradeTerrainMaterialLoopKit,verifyTerrainMaterialLoopKit} from '../src/terrain-material-loop-upgrade.mjs';
import {upgradeTerrainStepCornerKit,verifyTerrainStepCornerKit} from '../src/terrain-step-corner-upgrade.mjs';
const commands={
  fork:['source-workflow','out','project-id'],preview:['workflow','options'],freeze:['workflow','options'],
  'recovery-preview':['workflow','options'],'recovery-freeze':['workflow','options'],
  inspect:['workflow','batch'],'compute-review':['workflow','batch','out'],authorize:['workflow','batch','decision'],
  reserve:['workflow','batch','out'],receive:['workflow','exchange','file'],'stop-unknown':['workflow','exchange'],
  'run-codex':['workflow','batch','out','transport-workspace'],
  deliver:['workflow','base-kit','batch','controls','out'],verify:['workflow','base-kit','batch','controls','out'],
  'deliver-bottom':['workflow','base-kit','batch','controls','out'],'verify-bottom':['workflow','base-kit','batch','controls','out'],
  'native-size-propose':['workflow','plan','parent-batch','out'],
  'native-size-adopt':['workflow','proposal','decision','preparation-id','batch-id'],
  'canvas-gutter-review':['workflow','plan','parent-batch','out'],
  'canvas-gutter-apply':['workflow','review','decision','preparation-id','batch-id'],
  'canvas-gutter-auto':['workflow','plan','parent-batch'],
  'enable-grid':['kit','document','out'],'verify-grid':['kit','document','out'],
  'enable-junctions':['kit','document','options','out'],'verify-junctions':['kit','document','options','out'],
  'enable-union-material':['kit','document','out'],'verify-union-material':['kit','document','out'],
  'enable-material-loop':['kit','document','options','out'],'verify-material-loop':['kit','document','options','out'],
  'enable-step-corners':['kit','document','options','out'],'verify-step-corners':['kit','document','options','out'],
};
try{
  const [command,...args]=process.argv.slice(2);
  if(!command||command==='--help')console.log(`Terrain edge supplement: isolated native side walls, top corners and optional bottom rims/corners.
fork --source-workflow COMPLETED_WORKFLOW --out NEW_WORKFLOW --project-id ID
preview|freeze --workflow WORKFLOW --options JSON
recovery-preview|recovery-freeze --workflow WORKFLOW --options JSON
Recovery freezes one identical-request new plan after a known technical failure or an explicitly bound indeterminate terminalSha256. A new digest confirmation is required.
Optional natural options: naturalSurfaceProfile: "reference-defined-cover-v1" requires coverageProfile: "full-perimeter-v1",
nativeSizeProfile: "bounded-native-4m-v1" and renderEnvelopeProfile: "visible-alpha8-outward16-native-rgba-v1"; omit surfaceFamily.
The accepted reference, checked native material and explicit item briefs define cover/body boundaries and permitted attachments; no default surface substance.
For native perimeter plans set gutterPolicy to "alpha-one-gutter-warning-v1" to report eligible Alpha=1 tails as warnings and retain the original PNG.
inspect --workflow WORKFLOW --batch SHA
compute-review --workflow WORKFLOW --batch SHA --out NEW_DIRECTORY
authorize --workflow WORKFLOW --batch SHA --decision EXACT_DIGEST_RECEIPT_JSON
reserve --workflow WORKFLOW --batch SHA --out NEW_EXCHANGE
receive --workflow WORKFLOW --exchange DIRECTORY --file NATIVE_PNG [--auto-weak-gutter true]
stop-unknown --workflow WORKFLOW --exchange DIRECTORY
run-codex --workflow WORKFLOW --batch SHA --out NEW_EXCHANGE --transport-workspace PRIVATE_DIRECTORY [--auto-weak-gutter true]
deliver|verify --workflow WORKFLOW --base-kit VERIFIED_KIT --batch SHA --controls JSON --out DELIVERY
deliver-bottom|verify-bottom --workflow WORKFLOW --base-kit VERIFIED_V6_SIDE_KIT --batch BOTTOM_THREE_SHA --controls JSON --out DELIVERY
native-size-propose --workflow WORKFLOW --plan REJECTED_SIZE_PLAN_SHA --parent-batch SHA --out NEW_REVIEW
native-size-adopt --workflow WORKFLOW --proposal REVIEW_PROPOSAL_JSON --decision EXACT_ACCEPT_JSON --preparation-id ID --batch-id ID
canvas-gutter-review --workflow WORKFLOW --plan REJECTED_GUTTER_PLAN_SHA --parent-batch SHA --out NEW_REVIEW
canvas-gutter-apply --workflow WORKFLOW --review EXACT_REVIEW_DIRECTORY --decision EXACT_ACCEPT_JSON --preparation-id ID --batch-id ID
canvas-gutter-auto --workflow WORKFLOW --plan REJECTED_PLAN_SHA --parent-batch SHA
enable-grid|verify-grid --kit VERIFIED_V3_EDGE_KIT --document AUTHOR_JSON --out GRID_DELIVERY
enable-junctions|verify-junctions --kit VERIFIED_V4_EDGE_KIT --document AUTHOR_JSON --options JSON --out JUNCTION_DELIVERY
enable-union-material|verify-union-material --kit VERIFIED_V5_EDGE_KIT --document AUTHOR_JSON --out UNION_DELIVERY
enable-material-loop|verify-material-loop --kit VERIFIED_V6_EDGE_KIT --document AUTHOR_JSON --options JSON --out LOOP_DELIVERY
enable-step-corners|verify-step-corners --kit VERIFIED_V6_EDGE_KIT --document AUTHOR_JSON --options JSON --out CORNER_DELIVERY
Only run-codex dispatches through the local Codex CLI. It runs one authorized request. Reservation is single-use and durable; failures and unknown outcomes stop the batch.
Compute confirmation must bind the freshly frozen batch digest; old reference/source authorizations do not authorize this supplement.`);
  else{
    const required=commands[command];check(required&&args.length%2===0,'TERRAIN_EDGE_ARGUMENTS');const options={};
    const allowed=['receive','run-codex'].includes(command)?[...required,'auto-weak-gutter']:required;
    for(let index=0;index<args.length;index+=2){const key=args[index].slice(2);check(args[index].startsWith('--')&&allowed.includes(key)&&!Object.hasOwn(options,key)&&args[index+1],'TERRAIN_EDGE_ARGUMENTS');options[key]=args[index+1];}
    check(required.every(key=>Object.hasOwn(options,key))&&(!Object.hasOwn(options,'auto-weak-gutter')||options['auto-weak-gutter']==='true'),'TERRAIN_EDGE_ARGUMENTS');
    const autoWeakGutter=options['auto-weak-gutter']==='true';
    const read=key=>parseJson(readSelectedFile(options[key]));let result;
    if(command==='fork')result=forkCompletedWorkflow(options['source-workflow'],options.out,options['project-id']);
    else if(command==='preview')result=flow.previewTerrainEdgeSources(options.workflow,read('options'));
    else if(command==='freeze')result=flow.freezeTerrainEdgeSources(options.workflow,read('options'));
    else if(command==='recovery-preview')result=flow.previewTerrainEdgeRecovery(options.workflow,read('options'));
    else if(command==='recovery-freeze')result=flow.freezeTerrainEdgeRecovery(options.workflow,read('options'));
    else if(command==='inspect')result=inspectTerrainEdgeBatch(options.workflow,options.batch);
    else if(command==='compute-review')result=prepareTerrainEdgeComputeReview(options.workflow,options.batch,options.out);
    else if(command==='authorize')result=flow.authorizeReferenceAssetBatch(options.workflow,options.batch,read('decision'));
    else if(command==='reserve')result=reserveTerrainEdgeExchange(options.workflow,options.batch,options.out);
    else if(command==='receive')result=receiveTerrainEdgeExchange(options.workflow,options.exchange,options.file,{autoWeakGutter});
    else if(command==='stop-unknown')result=stopTerrainEdgeExchange(options.workflow,options.exchange);
    else if(command==='run-codex'){
      const {createSceneCodexAdapter}=await import('../adapters/codex.mjs');
      const adapter=await createSceneCodexAdapter({workspace:options['transport-workspace']});
      result=await runTerrainEdgeExchange(options.workflow,options.batch,options.out,adapter,{autoWeakGutter});
    }
    else if(command==='canvas-gutter-review')result=exportTerrainEdgeCanvasGutterReview(options.workflow,options.plan,options['parent-batch'],options.out);
    else if(command==='canvas-gutter-auto'){
      const prepared=flow.autoPrepareTerrainEdgeCanvasGutterSource(options.workflow,options.plan,options['parent-batch']);
      result=prepared?{...prepared,status:'prepared',generationCalls:0}:{status:'ineligible',generationCalls:0};
    }
    else if(command==='canvas-gutter-apply')result=applyTerrainEdgeCanvasGutterReview(options.workflow,options.review,read('decision'),{preparationId:options['preparation-id'],batchId:options['batch-id']});
    else if(command==='native-size-propose'){
      const p=flow.proposeTerrainEdgeNativeSizePreparation(options.workflow,options.plan,options['parent-batch']);
      const files=new Map([['proposal.json',jsonBytes(p.proposal)],['source-native.png',p.bytes],['checker-preview.png',p.previews.original]]),
        bundle=seal({format:'ai_scene_terrain_edge_native_size_review_bundle_v1',proposalSha256:p.proposal.sha256,
          artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
      const prepared={files,bundle,report:p.proposal};
      if(existsSync(options.out))verifyProofBundle(options.out,prepared);else writeProofBundle(options.out,options.workflow,prepared);
      result={format:bundle.format,proposalSha256:p.proposal.sha256,reviewSha256:bundle.sha256,
        originalRawSha256:hash(p.bytes),generationCalls:0,adoptionGranted:false};
    }
    else if(command==='native-size-adopt'){
      const proposal=read('proposal');result=flow.prepareAndAdoptTerrainEdgeNativeSizeSource(options.workflow,{preparationId:options['preparation-id'],
        proposal,receipt:read('decision'),parentBatchSha256:proposal.parentBatchSha256,batchId:options['batch-id']});
    }
    else if(command==='enable-grid'||command==='verify-grid'){
      const input={root:options.kit,document:read('document'),output:options.out};
      result=command==='enable-grid'?upgradeTerrainBrushKit(input):verifyTerrainBrushKit(input);
    }
    else if(command==='enable-junctions'||command==='verify-junctions'){
      const input={root:options.kit,document:read('document'),junctionOptions:read('options'),output:options.out};
      result=command==='enable-junctions'?upgradeTerrainEdgeJunctionKit(input):verifyTerrainEdgeJunctionKit(input);
    }
    else if(command==='enable-union-material'||command==='verify-union-material'){
      const input={root:options.kit,document:read('document'),output:options.out};
      result=command==='enable-union-material'?upgradeTerrainUnionMaterialKit(input):verifyTerrainUnionMaterialKit(input);
    }
    else if(command==='enable-material-loop'||command==='verify-material-loop'){
      const input={root:options.kit,document:read('document'),loopOptions:read('options'),output:options.out};
      result=command==='enable-material-loop'?upgradeTerrainMaterialLoopKit(input):verifyTerrainMaterialLoopKit(input);
    }
    else if(command==='enable-step-corners'||command==='verify-step-corners'){
      const input={root:options.kit,document:read('document'),cornerOptions:read('options'),output:options.out};
      result=command==='enable-step-corners'?upgradeTerrainStepCornerKit(input):verifyTerrainStepCornerKit(input);
    }
    else{
      const input={workflow:options.workflow,baseKitRoot:options['base-kit'],batchSha256:options.batch,controls:read('controls'),output:options.out};
      result=command==='deliver-bottom'?buildTerrainBottomEdgeDelivery(input):command==='verify-bottom'?verifyTerrainBottomEdgeDelivery(input)
        :command==='deliver'?buildTerrainEdgeDelivery(input):verifyTerrainEdgeDelivery(input);
    }
    console.log(JSON.stringify(['ai_scene_grid_brush_upgrade_v1','ai_scene_terrain_edge_junction_upgrade_v1','ai_scene_terrain_union_material_upgrade_v1','ai_scene_terrain_material_loop_upgrade_v1','ai_scene_terrain_step_corner_upgrade_v1'].includes(result?.format)?{
      status:result.format==='ai_scene_grid_brush_upgrade_v1'?'grid-brush-kit-upgraded':result.format==='ai_scene_terrain_edge_junction_upgrade_v1'?'edge-junction-kit-upgraded':result.format==='ai_scene_terrain_material_loop_upgrade_v1'?'material-loop-kit-upgraded':result.format==='ai_scene_terrain_step_corner_upgrade_v1'?'step-corner-kit-upgraded':'union-material-kit-upgraded',receiptSha256:result.sha256,sourceKitSha256:result.sourceKitSha256,kitSha256:result.kitSha256,
      authorSha256:result.authorSha256,compiledSha256:result.compiledSha256,originalPngFiles:result.originalPngs.length,
      geometryChanged:result.geometryChanged,collisionChanged:result.collisionChanged,gridComponents:result.gridComponents,
      meshGridCells:result.meshGridCells,junctionsSha256:result.junctionsSha256,materialLoopSha256:result.materialLoopSha256,stepCornersSha256:result.stepCornersSha256,cornerConfiguration:result.cornerConfiguration,derivedBody:result.derivedBody,zip:result.zip,generationCalls:0}:result));
  }
}catch(error){console.error(JSON.stringify({ok:false,code:error.errors?.[0]?.code??'TERRAIN_EDGE_COMMAND_FAILED',message:'Stopped; preserve native PNGs and incomplete attempts. No automatic retry.'}));process.exitCode=1;}
