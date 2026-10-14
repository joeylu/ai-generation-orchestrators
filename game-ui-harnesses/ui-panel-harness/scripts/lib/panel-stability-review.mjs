/** Known structural defects and bounded copy heuristics, not a semantic quality oracle. */
export function inspectPanelStability(spec,state,purpose){
  const rows=spec.sections.flatMap(section=>section.rows),flags=[],notes=[];
  const flag=(code,rows,level='DEFECT')=>flags.push({code,rowIds:rows.map(row=>row.id),level});
  const buttons=rows.filter(row=>row.kind==='button');
  if(purpose==='login'){
    const inputs=rows.filter(row=>row.kind==='input'&&!row.readOnly),login=buttons.filter(row=>/^(?:登录|登入|登陆|login|sign\s?in)$/iu.test(row.buttonLabel.trim()));
    if(!inputs.length||!login.length)notes.push('CREDENTIAL_FORM_NOT_IDENTIFIED_REQUIRES_PURPOSE_REVIEW');
    else{
      for(const button of login){
        if(button.action.kind!=='submit')flag('LOGIN_BYPASSES_FORM_VALIDATION',[button]);
        else if(inputs.some(row=>!button.action.fields.includes(row.bind)))flag('LOGIN_OMITS_FORM_INPUT',[button]);
      }
      if(inputs.some(row=>!row.validation.required))flag('LOGIN_HAS_OPTIONAL_CREDENTIAL_INPUT',inputs.filter(row=>!row.validation.required),'REVIEW');
      if(inputs.some(row=>state[row.bind]!==''))flag('LOGIN_PREFILLED_CREDENTIAL_INPUT',inputs.filter(row=>state[row.bind]!==''),'REVIEW');
    }
  }
  if(purpose==='exit-confirmation'){
    const modal=rows.filter(row=>row.kind==='dialog'&&row.modal&&state[row.bind]);
    if(modal.length&&buttons.length)flag('CONFIRMATION_ACTION_BLOCKED_BY_MODAL',[...modal,...buttons]);
    const floating=rows.filter(row=>row.kind==='dialog'&&!row.modal&&state[row.bind]);
    if(floating.length&&buttons.length)flag('CONFIRMATION_FLOATING_DIALOG_WITH_EXTERNAL_ACTION',[...floating,...buttons],'REVIEW');
    if(buttons.length<2)notes.push('CONFIRM_CANCEL_PAIR_NOT_IDENTIFIED_REQUIRES_PURPOSE_REVIEW');
    if(buttons.length>=2&&new Set(buttons.map(row=>row.event)).size<2)flag('CONFIRM_CANCEL_SHARE_EVENT',buttons);
  }
  if(purpose==='mail-detail'){
    const copy=rows.filter(row=>row.kind==='text'&&/(?:查看|领取).{0,8}附件|附件.{0,8}(?:查看|领取)/u.test(row.text));
    const hasAttachment=rows.some(row=>/附件/u.test(row.label)),hasClaim=buttons.some(row=>/领取|提取/u.test(row.buttonLabel));
    if(copy.length&&(!hasAttachment||!hasClaim))flag('MAIL_COPY_REFERENCES_UNAVAILABLE_ATTACHMENT_ACTION',copy,'REVIEW');
  }
  if(purpose==='lobby'){
    const portal=rows.filter(row=>/推荐游戏|游戏分类|热门游戏/u.test(row.label??''));
    if(portal.length)flag('LOBBY_MAY_BE_MULTI_GAME_PORTAL',portal,'REVIEW');
  }
  if(purpose==='character-select'){
    const fixtures=rows.filter(row=>row.kind==='image'&&typeof row.source==='string'&&row.source.startsWith('image-fixtures/'));
    if(fixtures.length)flag('TEST_TEXTURE_USED_AS_CHARACTER_ART',fixtures,'REVIEW');
  }
  return {kind:'KNOWN_DEFECT_AND_COPY_HEURISTIC_OBSERVATION_NOT_FULL_SEMANTIC_ACCEPTANCE',purpose,status:flags.length?'FLAGS_PRESENT':'NO_KNOWN_FLAGS',flags,notes,humanPurposeCopyAndVisualReview:'REQUIRED'};
}

export function summarizeStabilitySamples(items,observations){
  const purposes=[...new Set(items.map(item=>item.stability.purpose))];
  return {kind:'FINITE_THREE_REPEAT_AND_ONE_VARIANT_SAMPLE_SUMMARY',populationReliability:'NOT_ESTABLISHED',humanReview:'NOT_RECORDED',groups:purposes.map(purpose=>{
    const cases=items.filter(item=>item.stability.purpose===purpose).map(item=>({id:item.id,...item.stability,...observations.find(value=>value.id===item.id)}));
    const repeats=cases.filter(item=>item.inputKind==='EXACT_TEXT_REPEAT');
    return {purpose,request:items.find(item=>item.stability.purpose===purpose).request.text,cases,repeatSamples:3,
      repeatDeliveries:repeats.filter(item=>item.outcome==='READY_TO_COMPILE'&&item.status==='PASS').length,
      repeatClarifications:repeats.filter(item=>item.outcome==='NEEDS_INPUT').length,
      repeatKnownFlagCases:repeats.filter(item=>item.knownReview?.flags.length||item.interactionReview?.flags.length).length};
  })};
}
