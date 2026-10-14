/** Focused checks for the two observed failures, never a complete semantic quality oracle. */
export function assessStabilityFix({purpose,bundle,browserStatus,interactionReview}){
  const checks=[];
  const check=(code,pass)=>checks.push({code,status:pass?'PASS':'FAIL'});
  check('VALIDATED_DELIVERY_AND_BROWSER',Boolean(bundle)&&browserStatus==='PASS');
  const rows=bundle?.spec.sections.flatMap(section=>section.rows)??[];
  if(purpose==='character-select'){
    const images=rows.filter(row=>row.kind==='image');
    // This cohort has no user artwork or image library. Image labels have already
    // passed the compiler's measured width/height gate when bundle is validated.
    check('UNPROVIDED_ARTWORK_REMAINS_PLACEHOLDER',Boolean(bundle)&&images.every(row=>row.source===null));
    check('CHARACTER_SELECTION_PRESENT',rows.some(row=>['radio','list','select'].includes(row.kind)&&row.enabled));
  }else if(purpose==='exit-confirmation'){
    const buttons=rows.filter(row=>row.kind==='button');
    check('TWO_DISTINCT_CHOICES_PRESENT',buttons.length>=2&&new Set(buttons.map(row=>row.event)).size===buttons.length);
    check('EACH_CHOICE_OPERABLE_FROM_INITIAL_STATE',buttons.length>=2&&interactionReview?.purpose===purpose
      &&buttons.every(row=>interactionReview.stages?.some(stage=>stage.rowId===row.id&&stage.visible===true
        &&stage.enabled===true&&stage.reachable===true&&stage.emitted===1&&stage.totalEmitted===1))
      &&interactionReview.flags?.length===0&&interactionReview.notes?.length===0);
  }else check('SUPPORTED_FOCUSED_PURPOSE',false);
  return {kind:'TARGETED_FAILURE_ACCEPTANCE_NOT_FULL_SEMANTIC_REVIEW',purpose,
    status:checks.every(check=>check.status==='PASS')?'PASS':'FAIL',checks,humanCopyAndVisualReview:'REQUIRED',actualServices:'NOT_CONNECTED'};
}
