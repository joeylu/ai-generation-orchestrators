import {snapshotJson} from './spec.mjs';
import {canonicalJson} from './canonical.mjs';

const abortError=()=>new DOMException('Game command cancelled','AbortError');
/** Local reference port/test double. Game implementations can supply the same four methods. */
export function createMemoryGamePort({initialState,validate=value=>value,commands={},onError=()=>{}}){
 if(typeof validate!=='function'||typeof onError!=='function'||!commands||Object.getPrototypeOf(commands)!==Object.prototype||Object.values(commands).some(value=>typeof value!=='function'))throw Error('GAME_PORT_OPTIONS');
 const checked=value=>{const snapshot=snapshotJson(value);if(!snapshot||Object.getPrototypeOf(snapshot)!==Object.prototype)throw Error('GAME_PORT_STATE');validate(structuredClone(snapshot));return snapshot;};
 let state=checked(initialState),alive=true;const listeners=new Set(),pending=new Set();
 const guard=()=>{if(!alive)throw Error('GAME_PORT_DESTROYED');};
 const update=patch=>{guard();const value=snapshotJson(patch);if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(key=>!Object.hasOwn(state,key)))throw Error('GAME_PORT_PATCH');const next=checked({...state,...value});if(canonicalJson(next)===canonicalJson(state))return structuredClone(state);state=next;for(const listener of [...listeners]){if(!alive)break;try{listener(structuredClone(state));}catch{try{onError({code:'GAME_PORT_SUBSCRIBER_ERROR'});}catch{}}}return structuredClone(state);};
 const cancel=command=>{guard();for(const item of pending)if(command===undefined||item.command===command)item.controller.abort();};
 return Object.freeze({getSnapshot(){guard();return structuredClone(state);},update,
  subscribe(listener){guard();if(typeof listener!=='function')throw Error('GAME_PORT_LISTENER');listeners.add(listener);return()=>listeners.delete(listener);},cancel,
  async invoke(command,payload,{signal,instanceId}={}){
   guard();if(!Object.hasOwn(commands,command))throw Error('GAME_PORT_COMMAND');const input=snapshotJson(payload),controller=new AbortController(),item={command,controller};const aborted=()=>controller.abort();signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)controller.abort();pending.add(item);
   const active=()=>{if(!alive||controller.signal.aborted)throw abortError();};
   try{active();const value=await commands[command](input,{signal:controller.signal,instanceId,getSnapshot(){active();return structuredClone(state);},update(patch){active();return update(patch);}});active();return value===undefined?null:snapshotJson(value);}
   finally{signal?.removeEventListener('abort',aborted);pending.delete(item);}
  },
  inspect:()=>({alive,subscribers:listeners.size,pending:[...pending].filter(item=>!item.controller.signal.aborted).length}),
  destroy(){if(!alive)return;cancel();alive=false;listeners.clear();},
 });
}
