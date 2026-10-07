/** Instance ownership and lifecycle. Rendering is supplied by an optional engine adapter. */
import {validatePanelBundle,createPanelBundle,panelBundleAssetInputs} from './panel-bundle.mjs';
import {validatePanelState} from './spec.mjs';
import {canonicalJson} from './canonical.mjs';

const fail=code=>{throw new Error(code);};
const clone=value=>structuredClone(value);
export function createPanelHost({core,mount,onEvent,onError}={}) {
  if(!core||typeof mount!=='function'||(onEvent!==undefined&&typeof onEvent!=='function')||(onError!==undefined&&typeof onError!=='function'))fail('PANEL_HOST_OPTIONS');
  const records=new Map(),listeners=new Set();if(onEvent)listeners.add(onEvent);let alive=true;
  const guard=()=>{if(!alive)fail('PANEL_HOST_DESTROYED');};
  const notifyError=(id,code)=>{try{onError?.({instanceId:id,code});}catch{}};
  const release=record=>{const adapter=record.adapter;record.adapter=null;record.controller?.abort();record.controller=null;adapter?.destroy();};
  const usable=record=>{guard();if(!record.bundle||record.status==='DESTROYED')fail('PANEL_HOST_INSTANCE_DESTROYED');if(!['OPEN','CLOSED'].includes(record.status))fail('PANEL_HOST_INSTANCE_NOT_READY');};
  const current=record=>{usable(record);if(record.adapter)record.state=validatePanelState(record.bundle.spec,record.adapter.getState());return clone(record.state);};
  const close=record=>{if(record.status==='DESTROYED'||record.status==='CLOSED')return;if(record.status==='VALIDATING')fail('PANEL_HOST_INSTANCE_NOT_READY');if(record.status==='OPEN')record.state=validatePanelState(record.bundle.spec,record.adapter.getState());record.epoch++;record.status='CLOSED';release(record);};
  const destroy=record=>{if(record.status==='DESTROYED')return;record.epoch++;record.status='DESTROYED';try{release(record);}finally{record.bundle=null;record.state=null;record.options=null;records.delete(record.id);}};
  const open=async record=>{
    guard();if(!record.bundle||record.status==='DESTROYED')fail('PANEL_HOST_INSTANCE_DESTROYED');if(record.status==='OPEN')return record.api;if(record.status==='OPENING')return record.pending;
    const epoch=++record.epoch;record.status='OPENING';const controller=new AbortController();record.controller=controller;
    const promise=(async()=>{
      let adapter;
      try{
        adapter=await mount({instanceId:record.id,bundle:clone(record.bundle),state:clone(record.state),options:record.options,signal:controller.signal,
          onEvent:event=>{if(!alive||record.epoch!==epoch||record.status!=='OPEN')return;record.state=validatePanelState(record.bundle.spec,record.adapter.getState());const envelope={instanceId:record.id,panelId:record.bundle.spec.id,event:clone(event)};for(const listener of [...listeners]){if(!alive||record.epoch!==epoch||record.status!=='OPEN')break;try{listener(clone(envelope));}catch{notifyError(record.id,'PANEL_HOST_CALLBACK_ERROR');}}},
          onFatal:()=>{if(!alive||record.epoch!==epoch)return;record.epoch++;record.status='ERROR';try{release(record);}catch{}notifyError(record.id,'PANEL_HOST_RENDER_FAILED');}});
        if(!alive||record.epoch!==epoch||controller.signal.aborted){adapter?.destroy();adapter=null;fail('PANEL_HOST_OPEN_CANCELLED');}
        if(!adapter||['getState','setState','inspect','destroy'].some(key=>typeof adapter[key]!=='function'))fail('PANEL_HOST_ADAPTER');
        const hydrated=validatePanelState(record.bundle.spec,adapter.getState());if(canonicalJson(hydrated)!==canonicalJson(record.state))fail('PANEL_HOST_HYDRATION');
        record.adapter=adapter;record.status='OPEN';return record.api;
      }catch(error){if(adapter&&record.adapter!==adapter)adapter.destroy();if(alive&&record.epoch===epoch){record.status='CLOSED';record.controller=null;}throw error;}
    })();record.pending=promise;return promise;
  };
  const write=(record,input)=>{usable(record);const next=validatePanelState(record.bundle.spec,input);if(record.adapter)try{record.adapter.setState(next);}catch(error){record.epoch++;record.status='ERROR';try{release(record);}catch{}notifyError(record.id,'PANEL_HOST_WRITE_FAILED');throw error;}record.state=next;return clone(next);};
  const partial=(record,fieldId,value,type)=>{usable(record);if(record.bundle.spec.state.find(field=>field.id===fieldId)?.type!==type)fail(type==='progress'?'PANEL_PROGRESS_FIELD':'PANEL_INPUT_FIELD');return write(record,{...current(record),[fieldId]:value});};
  return Object.freeze({
    async add(id,bundleInput,options={}){
      guard();if(typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(id))fail('PANEL_HOST_INSTANCE_ID');if(records.has(id))fail('PANEL_HOST_INSTANCE_EXISTS');
      const record={id,bundle:null,state:null,options,status:'VALIDATING',epoch:0,adapter:null,controller:null,pending:null,api:null};records.set(id,record);
      const api=Object.freeze({id,get status(){return record.status;},open:()=>open(record),close:()=>close(record),destroy:()=>destroy(record),getState:()=>current(record),setState:value=>write(record,value),setProgress:(field,value)=>partial(record,field,value,'progress'),setText:(field,value)=>partial(record,field,value,'string'),
        async exportBundle(){const state=current(record);return createPanelBundle(record.bundle.spec,record.bundle.catalog,core,state,panelBundleAssetInputs(record.bundle,core));},
        inspect:()=>({instanceId:id,status:record.status,...(record.adapter?record.adapter.inspect():{instances:0,externalListeners:0,resources:0,nodes:[]})})});record.api=api;
      try{const bundle=await validatePanelBundle(bundleInput,core);if(!alive||records.get(id)!==record||record.status==='DESTROYED')fail('PANEL_HOST_DESTROYED');record.bundle=bundle;record.state=clone(bundle.state);record.status='CLOSED';await open(record);return api;}
      catch(error){try{destroy(record);}catch{}throw error;}
    },
    get(id){guard();return records.get(id)?.api;},
    subscribe(listener){guard();if(typeof listener!=='function')fail('PANEL_HOST_LISTENER');listeners.add(listener);return()=>listeners.delete(listener);},
    inspect(){return{alive,instances:[...records.values()].map(record=>record.api.inspect()),subscribers:listeners.size};},
    destroy(){if(!alive)return;alive=false;listeners.clear();const errors=[];for(const record of [...records.values()])try{destroy(record);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'PANEL_HOST_CLEANUP_FAILED');},
  });
}
