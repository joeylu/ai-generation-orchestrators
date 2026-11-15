import {check} from './common.mjs';

export const COMPLETE_SOURCE_FRAMING_PROFILE='complete-silhouette-v1';
export const COMPLETE_SOURCE_FRAMING_INSTRUCTION='Return one complete isolated group on genuine transparency with continuous Alpha and real transparent openings. Leave enough transparent space around the complete contour for its antialiased edges, owned shadows and glow, without wasting the canvas or shrinking visible features to satisfy a fixed margin percentage. No owned contour, shadow or glow is cut by the image border. Complete previously hidden parts consistently; these are design assumptions, not measured reconstruction. The program places the asset later; preserve its visible proportions and do not use transparent margins to define them.';

// This only selects prompt framing. It changes neither native PNG QA nor
// feature fitting, and cannot override a continuous band's finite-cut contract.
export function validateSourceFraming(scope){
  check(scope.framingProfile===COMPLETE_SOURCE_FRAMING_PROFILE,'SOURCE_FRAMING_PROFILE');
  check(['backdrop','landmark','scenery','valley','platform','foreground'].includes(scope.role)
    &&!Object.hasOwn(scope,'backgroundBand')&&!Object.hasOwn(scope,'bandCompositionGuide'),'SOURCE_FRAMING_ROLE');
}
