import {DAILY_DEFAULT_SUITE} from '../daily-defaults-v1/suite.mjs';
export const READABLE_HEADING_SOURCE_PLAN_SHA256='b11541e7e6c23b6a90d76c93481b4cd2b031f142ce01019ee2206b3bc4992c8a';
/** Unchanged short requests: the observed duplicate plus settings, selection and confirmation regressions. */
export const READABLE_HEADING_SUITE=Object.freeze(['G22','G03','G17','G54'].map(id=>{
 const item=DAILY_DEFAULT_SUITE.find(item=>item.id===id);if(!item)throw Error('HEADING_CASE_MISSING');return item;
}));
