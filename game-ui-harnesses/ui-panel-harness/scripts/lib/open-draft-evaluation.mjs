import assert from 'node:assert/strict';

/** Only protocol and explicit constraints. Relevance and necessity are NOT automatically certified. */
export function checkOpenDraft(item,result){
  assert(['READY_TO_COMPILE','NEEDS_INPUT'].includes(result.report.status),'DRAFT_INVALID_OUTCOME');
  if(result.report.status==='NEEDS_INPUT'){
    assert.equal(result.proposal.spec,null,'DRAFT_PARTIAL_RESULT');
    assert(result.proposal.unresolved.length>0,'DRAFT_EMPTY_QUESTION');
    return;
  }
  const spec=result.proposal.spec,rows=spec.sections.flatMap(section=>section.rows),fields=new Map(spec.state.map(field=>[field.id,field]));
  assert(rows.length>0,'DRAFT_EMPTY');
  const explicit=item.evaluation.explicit;
  if(!explicit)return;
  assert.deepEqual(rows.map(row=>row.kind),explicit.kinds,'DRAFT_EXPLICIT_KINDS');
  const labels=rows.map(row=>row.kind==='button'?row.buttonLabel:row.label);
  explicit.labels.forEach((label,index)=>{if(label!==null)assert.equal(labels[index],label,'DRAFT_EXPLICIT_LABEL');});
  for(const [label,value]of Object.entries(explicit.initials)){
    const row=rows[labels.indexOf(label)];assert.equal(fields.get(row.bind)?.initial,value,'DRAFT_EXPLICIT_DEFAULT');
  }
  for(const [label,value]of Object.entries(explicit.textValues))assert.equal(rows[labels.indexOf(label)].text,value,'DRAFT_EXPLICIT_TEXT');
  for(const [index,value]of Object.entries(explicit.textValuesByIndex))assert.equal(rows[Number(index)].text,value,'DRAFT_EXPLICIT_TEXT');
  for(const row of rows){if(Object.hasOwn(row,'enabled'))assert.equal(row.enabled,true,'DRAFT_DISABLED_REQUESTED_CONTROL');
    if(row.kind==='button')assert.equal(row.action.kind,'emit','DRAFT_UNREQUESTED_ACTION');}
}

export function draftReviewRecord(item,result,facts){
  return {kind:'OPEN_DRAFT_TECHNICAL_OBSERVATION',request:item.request.text,outcome:result.report.status,
    explicitConstraints:item.evaluation.explicit,observedFacts:facts??null,questions:result.proposal.unresolved,
    inferredChoicesNotice:'Unspecified controls, labels, values and design choices are unreviewed draft suggestions, not user-supplied requirements or real game data.',
    contentReasonableness:'HUMAN_REVIEW_REQUIRED',clarificationNecessity:'HUMAN_REVIEW_REQUIRED',visualQuality:'HUMAN_REVIEW_REQUIRED'};
}
