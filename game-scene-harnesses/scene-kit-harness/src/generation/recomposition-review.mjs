import {check, digest, exact, id, imageRef, isDigest, seal, text, unseal} from './common.mjs';

// This validates a structured visual review; it is not a vision model and does
// not prove that the supplied screenshot was captured from the stated map.
const AREAS = ['background', 'midground', 'foreground'];
const CHECKS = ['depth', 'composition', 'source-content', 'joins', 'brush'];
const rect = value => {
  check(Array.isArray(value) && value.length === 4 && value.every(Number.isFinite), 'RECOMPOSITION_REGION');
  const [x,y,w,h] = value;
  check(x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= 1 && y+h <= 1, 'RECOMPOSITION_REGION');
};
export function checkRecompositionReview({referenceBytes, studioCaptureBytes, mapSha256, kitSha256, observations}) {
  const reference = imageRef(referenceBytes,{allowCabx:true}), capture = imageRef(studioCaptureBytes);
  check(isDigest(mapSha256) && isDigest(kitSha256), 'RECOMPOSITION_IDENTITY');
  check(Array.isArray(observations) && observations.length <= 100, 'RECOMPOSITION_LIMIT');
  const findings = [], seen = new Set(), areas = new Set(), checks = new Set(), areaChecks = new Set();
  for (const item of observations) {
    exact(item, ['observationId','area','check','referenceRegion','captureRegion','referenceFinding','captureFinding','verdict']);
    id(item.observationId); check(!seen.has(item.observationId), 'RECOMPOSITION_DUPLICATE'); seen.add(item.observationId);
    check(AREAS.includes(item.area) && CHECKS.includes(item.check), 'RECOMPOSITION_KIND');
    rect(item.referenceRegion); rect(item.captureRegion);
    text(item.referenceFinding,{limit:1200}); text(item.captureFinding,{limit:1200});
    check(['match','mismatch','uncertain'].includes(item.verdict), 'RECOMPOSITION_VERDICT');
    areas.add(item.area); checks.add(item.check); areaChecks.add(`${item.area}:${item.check}`);
    if (item.verdict !== 'match') findings.push({code:item.verdict === 'mismatch' ? 'VISUAL_MISMATCH' : 'VISUAL_UNCERTAIN',observationId:item.observationId});
  }
  for (const area of AREAS) if (!areas.has(area)) findings.push({code:'AREA_NOT_REVIEWED',area});
  for (const kind of CHECKS) if (!checks.has(kind)) findings.push({code:'CHECK_NOT_REVIEWED',check:kind});
  for (const area of AREAS) for (const kind of ['composition','source-content'])
    if (!areaChecks.has(`${area}:${kind}`)) findings.push({code:'AREA_CHECK_NOT_REVIEWED',area,check:kind});
  return seal({format:'ai_scene_recomposition_review_v1',reference,capture,mapSha256,kitSha256,
    observationsSha256:digest(observations),status:findings.length ? 'blocked' : 'reviewed',findings,
    automaticImageUnderstanding:false,captureProvenance:'not-verified',brushInteraction:'not-verified',humanArtAcceptance:'not-assessed',generationCalls:0});
}
export function assertRecompositionReview(options, report) {
  unseal(report); const actual = checkRecompositionReview(options);
  check(digest(actual) === digest(report), 'RECOMPOSITION_STALE');
  check(actual.status === 'reviewed', 'RECOMPOSITION_BLOCKED');
  return actual;
}
