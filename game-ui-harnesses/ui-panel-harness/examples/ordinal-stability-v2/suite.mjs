import { ORDINAL_STABILITY_SUITE as original } from '../ordinal-stability-v1/suite.mjs';

/** Same16 requests/business facts; a group-grid need not be the tree root. */
export const ORDINAL_STABILITY_SUITE = structuredClone(original);
ORDINAL_STABILITY_SUITE.scope = 'Same16 fixed requests in two independent cohorts. Graphics group-grid may have one geometrically transparent fill-width column wrapper. No arbitrary-input or native-engine certification.';
ORDINAL_STABILITY_SUITE.cases.find(item => item.id === 'eval-graphics').expected.layout.allowSingleColumnWrapper = true;
