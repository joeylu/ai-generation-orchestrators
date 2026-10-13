import assert from 'node:assert/strict';
import {canonicalJson} from '../../src/canonical.mjs';
import {checkOpenDraft} from './open-draft-evaluation.mjs';

/** Business assertions deliberately ignore unspecified theme, decoration and geometry. */
export function businessFacts(spec) {
  const rows=spec.sections.flatMap(section=>section.rows),fields=new Map(spec.state.map(field=>[field.id,field]));
  const owner=id=>rows.find(row=>row.bind===id)?.buttonLabel??rows.find(row=>row.bind===id)?.label??id;
  const rowFacts=row=>{
    const result={kind:row.kind,label:row.kind==='button'?row.buttonLabel:row.label};
    if(Object.hasOwn(row,'enabled'))result.enabled=row.enabled;
    const field=fields.get(row.bind);
    if(field){result.initial=field.options?field.options.find(option=>option.id===field.initial)?.label:field.initial;
      for(const key of ['min','max','step','maxLength'])if(Object.hasOwn(field,key))result[key]=field[key];
      if(field.options)result.options=field.options.map(option=>option.label);}
    for(const key of ['text','inputType','readOnly','placeholder','itemHeight','visibleItems','title','closeLabel','modal','dialogWidth','dialogHeight','source','height','width','fit'])if(Object.hasOwn(row,key))result[key]=row[key];
    if(row.validation)result.validation={required:row.validation.required,minLength:row.validation.minLength};
    if(row.action)result.action={kind:row.action.kind,...(row.action.fields?{fields:row.action.fields.map(owner)}:{})};
    if(row.kind==='slider')result.format={prefix:row.format.prefix,suffix:row.format.suffix};
    if(row.kind==='progress')result.format=row.format;
    return result;
  };
  const tabs=spec.tabs?{pages:spec.tabs.pages.map(page=>({label:page.label,rows:spec.sections.filter(section=>page.sections.includes(section.id)).flatMap(section=>section.rows).map(rowFacts)})),initial:fields.get(spec.tabs.bind).options.find(option=>option.id===fields.get(spec.tabs.bind).initial)?.label}:null;
  return {title:spec.title,rows:rows.map(rowFacts),tabs};
}

export function checkAdaptabilityResult(item,result,{expectedSpec,before,after}={}) {
  if(item.evaluation?.kind==='OPEN_DRAFT_REVIEW')return checkOpenDraft(item,result);
  if(item.clarification){
    assert.equal(result.report.status,'NEEDS_INPUT','ADAPT_OUTCOME');
    assert.equal(result.proposal[item.operation==='edit'?'patch':'spec'],null,'ADAPT_PARTIAL_RESULT');
    assert(result.proposal.unresolved.length>0,'ADAPT_QUESTION_MISSING');
    assert(new RegExp(item.clarification.questionPattern,'iu').test(result.proposal.unresolved.map(value=>value.question).join(' ')),'ADAPT_QUESTION_UNRELATED');
    if(before)assert.equal(canonicalJson(after),canonicalJson(before),'ADAPT_CLARIFICATION_MUTATION');
    return;
  }
  assert.equal(result.report.status,item.operation==='edit'?'READY_TO_APPLY':'READY_TO_COMPILE','ADAPT_OUTCOME');
  if(item.operation==='edit'){
    assert.equal(canonicalJson(after.spec),canonicalJson(expectedSpec),'ADAPT_EDIT_SCOPE_OR_FACTS');
    assert.equal(canonicalJson(after.state),canonicalJson(before.state),'ADAPT_LIVE_STATE_CHANGED');
  } else {
    assert.equal(canonicalJson(businessFacts(result.proposal.spec)),canonicalJson(businessFacts(expectedSpec)),'ADAPT_BUSINESS_FACTS');
    if(item.reference.canvas)assert.deepEqual(result.proposal.spec.canvas,item.reference.canvas,'ADAPT_CANVAS');
    if(item.reference.minCanvasHeight!==undefined)assert(after.spec.canvas.height>=item.reference.minCanvasHeight,'ADAPT_CANVAS_TOO_SHORT');
    if(item.reference.maxCanvasHeight!==undefined)assert(after.spec.canvas.height<=item.reference.maxCanvasHeight,'ADAPT_CANVAS_TOO_TALL');
    if(item.reference.requiredTypes){const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
      assert.deepEqual([...new Set(flatten(after.componentBundle.document.root).map(node=>node.type))].sort(),item.reference.requiredTypes,'ADAPT_NATIVE_TYPES');}
  }
}
