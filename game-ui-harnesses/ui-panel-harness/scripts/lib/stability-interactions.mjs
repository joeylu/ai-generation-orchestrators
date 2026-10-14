import {controlId} from '../../src/compiler.mjs';
import {acceptanceInputValue} from './acceptance-input.mjs';
/** Exercise saved deliveries offline. Observed defects remain visible, never repaired here. */
export async function observeStabilityInteractions(page,bundle,purpose){
  const spec=bundle.spec,rows=spec.sections.flatMap(section=>section.rows),flags=[],stages=[],notes=[];
  const state=()=>page.evaluate(()=>window.panelDelivery.getState()),events=()=>page.evaluate(()=>window.panelDelivery.events());
  const inspect=()=>page.evaluate(()=>window.panelDelivery.inspect());
  const flag=(code,rowId)=>flags.push({code,rowId});
  async function click(row){
    const node=(await inspect()).nodes.find(node=>node.id===controlId(spec.id,row.id)),canvas=page.locator('canvas');
    if(!node?.bounds)return false;
    await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
    await page.mouse.click(box.x+(node.bounds.x+node.bounds.width/2)*box.width/spec.canvas.width,box.y+(node.bounds.y+node.bounds.height/2)*box.height/spec.canvas.height);return true;
  }
  async function fill(row,value){
    const canvas=page.locator('canvas');await canvas.focus();
    for(let n=0;n<90;n++){await page.keyboard.press('Tab');if(await canvas.getAttribute('data-focused-component')===controlId(spec.id,row.id)){await page.locator('input').fill(value);return;}}
    throw new Error('STABILITY_INPUT_FOCUS_UNREACHABLE');
  }
  if(purpose==='login'){
    const inputs=rows.filter(row=>row.kind==='input'&&!row.readOnly),login=rows.find(row=>row.kind==='button'&&/^(?:登录|登入|登陆|login|sign\s?in)$/iu.test(row.buttonLabel.trim()));
    if(!inputs.length||!login)notes.push('CREDENTIAL_FORM_NOT_IDENTIFIED');
    else{
      for(const row of inputs)await fill(row,'');
      const submitEvents=async()=>(await events()).filter(item=>item.event.rowId===login.id);
      async function observe(stage,expectedEnabled){
        const node=(await inspect()).nodes.find(node=>node.id===controlId(spec.id,login.id)),before=(await submitEvents()).length;
        const reachable=await click(login),emitted=(await submitEvents()).length-before;
        stages.push({stage,enabled:node?.enabled??null,reachable,emitted});
        if(!reachable)flag('LOGIN_BUTTON_BOUNDS_MISSING',login.id);
        if(expectedEnabled===false&&(node?.enabled||emitted))flag('LOGIN_ACCEPTS_INVALID_FORM_'+stage.toUpperCase(),login.id);
        if(expectedEnabled===true&&(!node?.enabled||emitted!==1))flag('LOGIN_VALID_FORM_CANNOT_SUBMIT',login.id);
      }
      const required=inputs.filter(row=>row.validation.required);
      await observe('empty',required.length?false:null);
      if(required.length>=2){const field=spec.state.find(field=>field.id===required[0].bind);await fill(required[0],acceptanceInputValue(required[0],field));await observe('partial',false);}
      if(required.length){await fill(required.at(-1),'   ');await observe('whitespace',false);}
      for(const row of inputs){const field=spec.state.find(field=>field.id===row.bind);await fill(row,acceptanceInputValue(row,field));}
      await observe('valid',true);const emitted=(await submitEvents()).at(-1)?.event;
      if(emitted?.action!=='submit')flag('LOGIN_VALID_ACTION_IS_NOT_SUBMIT',login.id);
      else{const values=await state();if(inputs.some(row=>emitted.values[row.bind]!==values[row.bind]))flag('LOGIN_SUBMITTED_VALUES_MISSING_OR_CHANGED',login.id);}
    }
  }else if(purpose==='exit-confirmation'){
    const buttons=rows.filter(row=>row.kind==='button');
    if(buttons.length<2)notes.push('CONFIRM_CANCEL_PAIR_NOT_IDENTIFIED');
    for(const row of buttons){
      // Each choice is tested against a fresh initial confirmation state.
      await page.reload();await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');
      const node=(await inspect()).nodes.find(node=>node.id===controlId(spec.id,row.id)),before=(await events()).length;
      const reachable=await click(row),newEvents=(await events()).slice(before),emitted=newEvents.filter(item=>item.event.rowId===row.id&&item.event.name===row.event).length;
      stages.push({stage:row.buttonLabel,rowId:row.id,visible:node?.visible??null,enabled:node?.enabled??null,reachable,emitted,totalEmitted:newEvents.length});
      if(!reachable||!node?.visible||!node?.enabled||emitted!==1)flag('CONFIRMATION_CHOICE_NOT_INITIALLY_OPERABLE',row.id);
    }
  }
  return {kind:'ACTUAL_OFFLINE_FLOW_OBSERVATIONS_NOT_MODEL_OR_SERVICE_RESULTS',purpose,status:flags.length?'FLAGS_PRESENT':'NO_KNOWN_FLAGS',stages,flags,notes,actualServices:'NOT_CONNECTED'};
}
