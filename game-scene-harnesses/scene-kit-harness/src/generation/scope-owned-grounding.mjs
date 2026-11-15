import {check} from './common.mjs';

export const SCOPE_OWNED_GROUNDING_PROFILE='scope-owned-support-v1';
export const SCOPE_OWNED_GROUNDING_INSTRUCTION='GROUNDING OWNERSHIP: Include support forms, contact shading and small overlaps only when explicitly declared by the SINGLE-ASSET BRIEF, and only within this asset\'s own allowed parts. Do not infer additional support, host terrain or neighboring-layer forms from the complete reference. Preserve the legitimate bases and connections explicitly required by this brief.';

export function validateScopeOwnedGrounding(scope){
  check(scope.groundingProfile===SCOPE_OWNED_GROUNDING_PROFILE,'SCOPE_OWNED_GROUNDING_PROFILE');
  check(['landmark','scenery','foreground'].includes(scope.role),'SCOPE_OWNED_GROUNDING_ROLE');
}
