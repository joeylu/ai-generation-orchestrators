import {check,hash,unseal} from './generation/common.mjs';

// Integrity evidence, not a signed attestation of the local producer.
export function checkCaptureBinding(delivery,proof,sceneBytes){
  unseal(delivery);unseal(proof);
  check(['ai_scene_coherent_delivery_v1','ai_scene_terrain_edge_delivery_v1'].includes(delivery.format)&&proof.format==='ai_scene_coherent_studio_capture_v1'
    &&proof.deliverySha256===delivery.sha256&&proof.authorSha256===delivery.authorSha256,'RECOMPOSITION_CAPTURE_IDENTITY');
  check(proof.identity===true&&proof.nonblank===true&&proof.actualStudioFrame===true
    &&proof.editorVisibilityDoesNotChangeMap===true&&proof.browserSaveVerified===true&&proof.browserZipEqualsCli===true
    &&Array.isArray(proof.errors)&&proof.errors.length===0&&Array.isArray(proof.warnings)&&proof.warnings.length===0
    &&Array.isArray(proof.externalRequests)&&proof.externalRequests.length===0,'RECOMPOSITION_CAPTURE_CHECKS');
  check(Array.isArray(proof.artifacts),'RECOMPOSITION_CAPTURE_ARTIFACT');
  const frames=proof.artifacts.filter(a=>a?.path==='studio-scene.png');
  check(frames.length===1&&frames[0].sha256===hash(sceneBytes)&&frames[0].byteLength===sceneBytes.length,'RECOMPOSITION_CAPTURE_ARTIFACT');
  return {mapSha256:delivery.authorSha256,kitSha256:delivery.kitSha256};
}
