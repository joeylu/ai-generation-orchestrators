import {snapshotJson,validatePanelSpec,validatePanelState} from './spec.mjs';
import {canonicalJson} from './canonical.mjs';
import {buttonEnabled} from './forms.mjs';

const symbol=/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const safeKey=value=>typeof value==='string'&&symbol.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const fail=code=>{throw new Error(code);};
const keys=(value,expected,code)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||canonicalJson(Object.keys(value).sort())!==canonicalJson([...expected].sort()))fail(code);};

/** Explicit game-side routes. Labels and field-name guesses never select a game action. */
export function validateGameBinding(input,bundle){
 const binding=snapshotJson(input),spec=validatePanelSpec(bundle.spec);
 keys(binding,['gameBindingVersion','panelId','panelSha256','states','commands'],'GAME_BINDING_SHAPE');
 if(binding.gameBindingVersion!=='0.1'||binding.panelId!==spec.id||!/^[a-f0-9]{64}$/u.test(binding.panelSha256)||binding.panelSha256!==bundle.sha256)fail('GAME_BINDING_SOURCE');
 if(!Array.isArray(binding.states)||binding.states.length>128||!Array.isArray(binding.commands)||binding.commands.length>128)fail('GAME_BINDING_LIMIT');
 const fields=new Map(spec.state.map(field=>[field.id,field])),rows=new Map(spec.sections.flatMap(section=>section.rows).map(row=>[row.id,row])),fieldIds=new Set(),gameKeys=new Set(),rowIds=new Set();
 for(const state of binding.states){keys(state,['fieldId','key','direction'],'GAME_BINDING_STATE');if(!fields.has(state.fieldId)||fieldIds.has(state.fieldId)||!safeKey(state.key)||gameKeys.has(state.key)||!['two-way','from-game','to-game'].includes(state.direction))fail('GAME_BINDING_STATE');if(fields.get(state.fieldId).type==='progress'&&state.direction!=='from-game')fail('GAME_BINDING_PROGRESS');fieldIds.add(state.fieldId);gameKeys.add(state.key);}
 for(const command of binding.commands){keys(command,['rowId','command','payload','concurrency'],'GAME_BINDING_COMMAND');const row=rows.get(command.rowId);if(row?.kind!=='button'||!row.enabled||rowIds.has(command.rowId)||!safeKey(command.command)||!['replace','drop'].includes(command.concurrency))fail('GAME_BINDING_COMMAND');keys(command.payload,Object.keys(command.payload??{}),'GAME_BINDING_PAYLOAD');for(const [key,fieldId]of Object.entries(command.payload)){if(!safeKey(key)||!fields.has(fieldId)||(row.action.kind==='submit'&&!row.action.fields.includes(fieldId)))fail('GAME_BINDING_PAYLOAD');}rowIds.add(command.rowId);}
 return binding;
}

/** Attach one panel instance to one replaceable game port. The caller owns both lifetimes. */
export function attachPanelGameBinding({host,instanceId,bundle,binding:input,port,onChange=()=>{},onError=()=>{}}){
 const binding=validateGameBinding(input,bundle),panel=host.get(instanceId);
 if(!panel||!['OPEN','CLOSED'].includes(panel.status)||['getSnapshot','subscribe','update','invoke'].some(key=>typeof port?.[key]!=='function')||typeof onChange!=='function'||typeof onError!=='function')fail('GAME_BINDING_OPTIONS');
 let alive=true,syncing=false,detachHost=()=>{},detachPort=()=>{};const pending=new Map(),commands=new Map(binding.commands.map(route=>[route.rowId,route])),rows=new Map(bundle.spec.sections.flatMap(section=>section.rows).map(row=>[row.id,row]));
 const stats={started:0,completed:0,failed:0,cancelled:0,dropped:0,lastError:null};
 const signalChange=()=>{try{onChange();}catch{}};
 const error=(code,route=null)=>{stats.lastError=code;try{onError({instanceId,code,rowId:route?.rowId??null});}catch{}signalChange();};
 const live=()=>alive&&host.inspect().alive&&host.get(instanceId)===panel&&['OPEN','CLOSED'].includes(panel.status);
 const destroy=()=>{if(!alive)return;alive=false;for(const request of pending.values())request.controller.abort();pending.clear();const errors=[];for(const detach of [detachHost,detachPort])try{detach();}catch(cause){errors.push(cause);}detachHost=detachPort=()=>{};if(errors.length)throw new AggregateError(errors,'GAME_BINDING_CLEANUP');};
 const synchronize=snapshot=>{
  if(!live()){destroy();return;}const current=panel.getState(),next={...current};
  for(const route of binding.states.filter(route=>route.direction!=='to-game')){if(!Object.hasOwn(snapshot,route.key))fail('GAME_PORT_STATE_KEY');next[route.fieldId]=snapshot[route.key];}
  const checked=validatePanelState(bundle.spec,next);if(canonicalJson(current)===canonicalJson(checked))return;
  syncing=true;try{panel.setState(checked);}finally{syncing=false;}
 };
 const execute=async route=>{
  if(!live()){destroy();return{status:'DETACHED'};}
  if(!buttonEnabled(bundle.spec,rows.get(route.rowId),panel.getState()))return{status:'BLOCKED'};
  const previous=pending.get(route.rowId);if(previous){if(route.concurrency==='drop'){stats.dropped++;signalChange();return{status:'DROPPED'};}previous.controller.abort();}
  const request={controller:new AbortController()},state=panel.getState(),payload=Object.fromEntries(Object.entries(route.payload).map(([key,fieldId])=>[key,state[fieldId]]));pending.set(route.rowId,request);stats.started++;signalChange();
  try{const value=await port.invoke(route.command,payload,{signal:request.controller.signal,instanceId});if(!alive||request.controller.signal.aborted){stats.cancelled++;return{status:'CANCELLED'};}stats.completed++;stats.lastError=null;return{status:'COMPLETE',value};}
  catch(cause){if(!alive||request.controller.signal.aborted||cause?.name==='AbortError'){stats.cancelled++;return{status:'CANCELLED'};}stats.failed++;error(safeKey(cause?.code)?cause.code:'GAME_COMMAND_FAILED',route);return{status:'FAILED'};}
  finally{if(pending.get(route.rowId)===request)pending.delete(route.rowId);signalChange();}
 };
 try{
  // Validate incoming game state before writing or creating any subscriptions.
  synchronize(port.getSnapshot());
  detachPort=port.subscribe(snapshot=>{if(syncing)return;try{synchronize(snapshot);}catch(cause){error(cause.code??'GAME_STATE_REJECTED');}signalChange();});if(typeof detachPort!=='function')fail('GAME_PORT_SUBSCRIPTION');
  detachHost=host.subscribe(envelope=>{
   if(!alive||syncing||envelope.instanceId!==instanceId||envelope.panelId!==bundle.spec.id)return;
   if(!live()){destroy();return;}const event=envelope.event,rowsByEvent=[...rows.values()].filter(row=>row.event===event?.name),row=rowsByEvent[0];
   if(!row)return;
   try{
    const values=panel.getState(),changed=event.fieldId?[event.fieldId]:event.action==='reset-initial'?row.action.fields:[];
    const patch=Object.fromEntries(binding.states.filter(route=>route.direction!=='from-game'&&changed.includes(route.fieldId)).map(route=>[route.key,values[route.fieldId]]));
    if(Object.keys(patch).length)port.update(patch);
    const command=commands.get(row.id);if(command&&event.action===row.action?.kind)void execute(command);
   }catch(cause){error(safeKey(cause.code)?cause.code:'GAME_STATE_WRITE_FAILED');}
   signalChange();
  });if(typeof detachHost!=='function')fail('GAME_HOST_SUBSCRIPTION');
 }catch(cause){destroy();throw cause;}
 return Object.freeze({destroy,run(rowId){if(!alive)fail('GAME_BINDING_DESTROYED');const route=commands.get(rowId);if(!route)fail('GAME_BINDING_COMMAND');return execute(route);},inspect:()=>({alive,pending:pending.size,...stats})});
}
