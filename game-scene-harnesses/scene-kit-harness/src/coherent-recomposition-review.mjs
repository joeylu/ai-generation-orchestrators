import {join} from 'node:path';
import {parseJson,readSelectedFile} from './files.mjs';
import {checkCaptureBinding} from './coherent-capture-binding.mjs';
export {checkCaptureBinding} from './coherent-capture-binding.mjs';
import {checkRecompositionReview,assertRecompositionReview} from './generation/recomposition-review.mjs';
import {verifyCoherentDelivery} from './coherent-pipeline.mjs';

function inputs(root,deliveryDir,captureDir,observations) {
  // This replays the complete candidate, its reference and exported author map.
  verifyCoherentDelivery(root,deliveryDir);
  const delivery=parseJson(readSelectedFile(join(deliveryDir,'delivery.json')));
  const proof=parseJson(readSelectedFile(join(captureDir,'capture.json')));
  const studioCaptureBytes=readSelectedFile(join(captureDir,'studio-scene.png'),16777216);
  const referenceBytes=readSelectedFile(join(deliveryDir,'reference-native.png'),16777216);
  return {referenceBytes,studioCaptureBytes,...checkCaptureBinding(delivery,proof,studioCaptureBytes),observations};
}

// An explicit, opt-in check, not an existing delivery or art-review gate.
export function reviewCoherentStudioRecomposition(root,deliveryDir,captureDir,observations) {
  return checkRecompositionReview(inputs(root,deliveryDir,captureDir,observations));
}
export function assertCoherentStudioRecomposition(root,deliveryDir,captureDir,observations,report) {
  return assertRecompositionReview(inputs(root,deliveryDir,captureDir,observations),report);
}
