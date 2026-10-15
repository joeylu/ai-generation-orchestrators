// Only workspace dependency on Panel planning. A released consumer should use
// the pinned package subpath ai-ui-panel-harness/planning/v1 instead.
import * as provider from '../../../ui-panel-harness/src/planning-api-v1.mjs';
import compatibility from '../../configs/planning-compatibility.json' with {type:'json'};
const fail = message => { throw Object.assign(new Error(message),{code:'panel.planner-version'}); };
export function planningClient(api = provider) {
  if(api.PLANNING_API_VERSION !== compatibility.apiVersion || typeof api.preparePlanning!=='function' || typeof api.verifyPlanning!=='function')fail('Unsupported Panel planning API.');
  function accept(session) {
    const intentVersions = session.responseSchema?.properties?.panelIntentVersion?.enum;
    if(session.apiVersion!==compatibility.apiVersion || !Array.isArray(intentVersions) || intentVersions.length!==1
      || !compatibility.protocols.some(pair => pair.context===session.context?.planningContextVersion && pair.intent===intentVersions[0]))
      fail('Planning protocol is outside the tested compatibility list; upgrade explicitly.');
    return session;
  }
  return {
    async prepare(input){return accept(await api.preparePlanning(input));},
    async verify(input){return accept(await api.verifyPlanning(input));},
  };
}

export async function codexPlanningClient() {
  const api=await import('../../../ui-panel-harness/src/planning-codex-v1.mjs');
  if(api.CODEX_PLANNING_API_VERSION!=='1.0')fail('Unsupported optional Codex planning API.');
  return api;
}
