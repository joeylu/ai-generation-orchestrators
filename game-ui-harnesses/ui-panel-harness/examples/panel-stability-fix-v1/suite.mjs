import {PANEL_STABILITY_SUITE} from '../panel-stability-v1/suite.mjs';

export const STABILITY_FIX_SOURCE_PLAN_SHA256='56c0c71b17fdbf0919d4334eadef2834511b180fe369aec602279e565b4df5f0';
// Fresh, predeclared samples; preserve historical case IDs and user text for comparison.
// No failed attempt is resumed and no historical authorization is reused.
export const PANEL_STABILITY_FIX_SUITE=PANEL_STABILITY_SUITE
  .filter(item=>['character-select','exit-confirmation'].includes(item.stability.purpose))
  .map(item=>structuredClone(item));
