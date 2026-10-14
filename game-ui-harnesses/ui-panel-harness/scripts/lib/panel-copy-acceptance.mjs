import {isMessageText} from '../../src/message-text.mjs';

/** A bounded static-placeholder warning; multi-image character cards may be intentional. */
export function staticPlaceholderChoiceNames(spec){
  const rows=spec.sections.flatMap(section=>section.rows),images=rows.filter(row=>row.kind==='image'&&row.source===null);
  if(images.length!==1)return [];
  const choices=rows.filter(row=>['radio','list','select'].includes(row.kind));
  const names=choices.flatMap(row=>spec.state.find(field=>field.id===row.bind)?.options??[]).map(option=>{
    const label=option.label,name=label.split(/[.·：:]/u).at(-1).replace(/\s*[（(](?:示例|样例|占位)[）)]\s*$/u,'').trim();
    return {label,name};
  }).filter(value=>[...value.name].length>=2&&images[0].label.toLowerCase().includes(value.name.toLowerCase()));
  return names.length?[{rowId:images[0].id,label:images[0].label,matches:names}]:[];
}

export function assessPanelCopy({purpose,bundle,browserStatus}){
  const checks=[],check=(code,pass)=>checks.push({code,status:pass?'PASS':'FAIL'});
  check('VALIDATED_ORIGINAL_DELIVERY_AND_BROWSER',Boolean(bundle)&&browserStatus==='PASS');
  const rows=bundle?.spec.sections.flatMap(section=>section.rows)??[];
  if(purpose==='exit-confirmation'){
    const text=rows.filter(row=>row.kind==='text'),flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
    const nodes=bundle?flatten(bundle.componentBundle.document.root):[];
    check('MESSAGE_BODY_PRESENT_WITH_HIDDEN_RENDERED_LABEL',text.length>0&&text.every(row=>isMessageText(row,bundle.catalog)
      &&!nodes.some(node=>node.id===`${bundle.spec.id}.row.${row.id}.label`)));
  }else if(purpose==='character-select'){
    const warnings=bundle?staticPlaceholderChoiceNames(bundle.spec):[];
    checks.push({code:'UNBOUND_PREVIEW_COPY_NOT_CURRENT_CHARACTER_NAME',status:warnings.length?'REVIEW_REQUIRED':bundle?'PASS':'FAIL',warnings});
  }else check('SUPPORTED_COPY_REVIEW_PURPOSE',false);
  return {kind:'FOCUSED_MESSAGE_AND_STATIC_COPY_REVIEW_NOT_FULL_SEMANTIC_ACCEPTANCE',purpose,
    status:checks.some(check=>check.status==='FAIL')?'FAIL':checks.some(check=>check.status==='REVIEW_REQUIRED')?'REVIEW_REQUIRED':'PASS',checks,humanReview:'REQUIRED',nameMatching:'BOUNDED_HEURISTIC_NOT_COMPLETE_ORACLE'};
}
