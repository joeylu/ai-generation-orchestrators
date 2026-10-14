import {COMMON_GAME_PANEL_SUITE} from '../common-game-panels-v1/suite.mjs';
// Selection from the completed 64-case cohort, not a retry or a claim of its cause.
export const SOURCE_COMMON_PLAN_SHA256='2d00b6eeac00a058b27896d26189ea72682317e5300eb9728b11e24c78ff6e61';
export const PREVIOUS_FAILURE_IDS=['G03','G06','G17','G22','G27','G29','G30','G31','G33','G34','G35','G36','G38','G42','G47','G48','G49','G52','G54','G55','G57','G63','G64'];
export const LAYOUT_REVIEW_IDS=['G02','G18','G21','G26','G41','G43','G44','G59'];
export const CONTENT_REVIEW_IDS=['G09','G13','G20','G25','G45'];
export const EXPLICIT_REGRESSION_IDS=['G62'];
const selected=new Set([...PREVIOUS_FAILURE_IDS,...LAYOUT_REVIEW_IDS,...CONTENT_REVIEW_IDS,...EXPLICIT_REGRESSION_IDS]);
export const COMMON_GAME_PANEL_FIX_SUITE=COMMON_GAME_PANEL_SUITE.filter(item=>selected.has(item.id)).map(item=>({...structuredClone(item),
  sourceCaseId:item.id,reviewReason:PREVIOUS_FAILURE_IDS.includes(item.id)?'PREVIOUS_VALIDATION_FAILURE':LAYOUT_REVIEW_IDS.includes(item.id)?'DEFAULT_DIMENSIONS_AND_HEADINGS':CONTENT_REVIEW_IDS.includes(item.id)?'CONTENT_OBSERVATION':'EXPLICIT_SWITCH_DEFAULTS'}));
