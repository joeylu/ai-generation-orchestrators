// Consume the public API from the verified immutable SDK installation.
import {loadPanelSdkApi} from './sdk.mjs';
import compatibility from '../../configs/planning-compatibility.json' with {type:'json'};
const fail = message => { throw Object.assign(new Error(message),{code:'panel.planner-version'}); };
export function planningClient(api) {
  const validate=api=>{if(api.PLANNING_API_VERSION !== compatibility.apiVersion || typeof api.preparePlanning!=='function' || typeof api.verifyPlanning!=='function')fail('Unsupported Panel planning API.');return api;};
  if(api!==undefined)validate(api);
  const provider=async()=>validate(api??await loadPanelSdkApi('planning/v1'));
  function accept(session) {
    const intentVersions = session.responseSchema?.properties?.panelIntentVersion?.enum;
    if(session.apiVersion!==compatibility.apiVersion || !Array.isArray(intentVersions) || intentVersions.length!==1
      || !compatibility.protocols.some(pair => pair.context===session.context?.planningContextVersion && pair.intent===intentVersions[0]))
      fail('Planning protocol is outside the tested compatibility list; upgrade explicitly.');
    return session;
  }
  return {
    async prepare(input){return accept(await (await provider()).preparePlanning(input));},
    async verify(input){return accept(await (await provider()).verifyPlanning(input));},
  };
}

export async function codexPlanningClient() {
  const api=await loadPanelSdkApi('planning/codex/v1');
  if(api.CODEX_PLANNING_API_VERSION!=='1.0')fail('Unsupported optional Codex planning API.');
  return api;
}
