const fail=(code)=>{throw Object.assign(new Error(code),{code:'panel.action-'+code});};
export function initialFieldState(f){
  if(f.type==='input'||f.type==='slider')return {value:f.value};
  if(f.type==='check-box'||f.type==='switch')return {checked:f.type==='switch'?f.value:f.checked};
  if(f.type==='select')return {selectedId:f.value};
  return null;
}
// Pure local behavior; the host decides what an emitted/submitted event means.
export function applyPresetAction(behavior,id,state) {
  const a=behavior.actions.find(a=>a.id===id);if(!a||!a.enabled)fail('disabled-action');
  const next=structuredClone(state),errors=[];
  for(const target of a.targets) {
    const f=behavior.fields.find(f=>f.id===target);if(!f||!Object.hasOwn(next,target))fail('state');
    if(a.action==='reset-initial')next[target]=initialFieldState(f);
    else if(f.type==='input') {
      const value=next[target].value;
      if(typeof value!=='string'||(f.required&&!value.trim())||value.length<f.minLength||value.length>f.maxLength)errors.push({id:target,label:f.label,code:'input-length-or-required'});
    }
  }
  return {state:next,errors,event:errors.length?null:{action:a.action,id,values:Object.fromEntries(a.targets.map(id=>[id,next[id]]))},dismiss:!errors.length&&a.action==='emit'&&behavior.dismissOnEmit};
}
