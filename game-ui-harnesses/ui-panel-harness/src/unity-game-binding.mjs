import {validateGameBinding} from './game-binding.mjs';
import {digestJson} from './canonical.mjs';

/** JsonUtility needs payload routes as arrays; retain the common binding's digest. */
export async function createUnityGameBinding(input,bundle){
 const binding=validateGameBinding(input,bundle);
 return {unityGameBindingVersion:'0.1',panelId:binding.panelId,panelSha256:binding.panelSha256,
  sourceBindingSha256:await digestJson(binding),states:binding.states,
  commands:binding.commands.map(command=>({...command,payload:Object.entries(command.payload).map(([key,fieldId])=>({key,fieldId}))}))};
}
