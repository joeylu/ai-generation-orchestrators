/** Generate valid synthetic text from the saved field contract, never from model prose. */
export function acceptanceInputValue(row,field){
  const minimum=Math.max(row.validation.required?1:0,row.validation.minLength,1);
  if(field.type!=='string'||!Number.isInteger(field.maxLength)||minimum>field.maxLength)
    throw new Error('ACCEPTANCE_INPUT_CONTRACT');
  const length=Math.min(field.maxLength,Math.max(2,minimum));
  return '验收'.repeat(Math.ceil(length/2)).slice(0,length);
}
