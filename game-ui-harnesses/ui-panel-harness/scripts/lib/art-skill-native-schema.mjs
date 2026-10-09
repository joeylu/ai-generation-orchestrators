import {canonicalJson} from '../../src/canonical.mjs';
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
function literal(value){
  if(value===null)return{type:'null'};
  if(Array.isArray(value))throw new Error('ART_NATIVE_LITERAL_ARRAY_UNSUPPORTED');
  if(typeof value==='object')return object(Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,literal(entry)])));
  return{type:typeof value==='number'&&Number.isInteger(value)?'integer':typeof value,enum:[value]};
}
/** Match the existing Codex editor's conservative shape conversion; runtime keeps every original constraint. */
export function lowerArtNativeSchema(schema){
  if(schema.anyOf)return{anyOf:schema.anyOf.map(lowerArtNativeSchema)};
  if(schema.enum){
    if(schema.enum.some(value=>value!==null&&typeof value==='object'))return{anyOf:schema.enum.map(literal)};
    const types=[...new Set(schema.enum.map(value=>value===null?'null':typeof value))];
    return{type:types.length===1?types[0]:types,enum:[...schema.enum]};
  }
  if(schema.type==='object')return object(Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,lowerArtNativeSchema(value)])));
  if(schema.type==='array')return{type:'array',items:lowerArtNativeSchema(schema.items),
    ...(schema.minItems===undefined?{}:{minItems:schema.minItems}),...(schema.maxItems===undefined?{}:{maxItems:schema.maxItems})};
  if(schema.type)return{type:schema.type};
  throw new Error('ART_NATIVE_SCHEMA_UNSUPPORTED');
}

/** The original evaluation schema stays authoritative after native shape conversion. */
export function validateArtResponseConstraints(value,schema,path='$'){
  const fail=rule=>{const error=new Error(`ART_RESPONSE_CONSTRAINT ${path}: ${rule}`);error.code='ART_RESPONSE_CONSTRAINT';throw error;};
  if(schema.anyOf){
    for(const branch of schema.anyOf){try{validateArtResponseConstraints(value,branch,path);return value;}catch(error){if(error.code!=='ART_RESPONSE_CONSTRAINT')throw error;}}
    fail('anyOf');
  }
  if(schema.enum&&!schema.enum.some(item=>canonicalJson(item)===canonicalJson(value)))fail('enum');
  if(schema.type){
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    const fits=type=>type==='null'?value===null:type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='array'?Array.isArray(value):
      type==='integer'?Number.isSafeInteger(value):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type;
    if(!types.some(fits))fail('type');
  }
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)&&schema.properties){
    if((schema.required??[]).some(key=>!Object.hasOwn(value,key)))fail('required');
    if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)))fail('additionalProperties');
    for(const [key,entry] of Object.entries(value))if(schema.properties[key])validateArtResponseConstraints(entry,schema.properties[key],`${path}.${key}`);
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)fail('array length');
    if(schema.items)value.forEach((entry,index)=>validateArtResponseConstraints(entry,schema.items,`${path}[${index}]`));
  }
  if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))fail('number range');
  if(typeof value==='string'){
    const length=[...value].length;
    if(schema.minLength!==undefined&&length<schema.minLength||schema.maxLength!==undefined&&length>schema.maxLength)fail('string length');
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))fail('pattern');
  }
  return value;
}

/** Structural audit, not a substitute for server acceptance. */
export function auditArtNativeSchema(schema){
  const problems=[];
  function visit(node,path){
    if(node.anyOf){node.anyOf.forEach((branch,index)=>visit(branch,`${path}.anyOf[${index}]`));return;}
    if(!node.type)problems.push(`${path}: missing explicit type`);
    if(node.enum?.some(value=>value!==null&&typeof value==='object'))problems.push(`${path}: object enum`);
    if(['minLength','maxLength','pattern','minimum','maximum'].some(key=>Object.hasOwn(node,key)))problems.push(`${path}: constraints belong to the preserved runtime schema`);
    if(node.type==='object'){
      if(node.additionalProperties!==false||JSON.stringify([...(node.required??[])].sort())!==JSON.stringify(Object.keys(node.properties??{}).sort()))problems.push(`${path}: strict object fields`);
      for(const [key,value] of Object.entries(node.properties??{}))visit(value,`${path}.${key}`);
    }
    if(node.type==='array')visit(node.items,`${path}.items`);
  }
  visit(schema,'$');return problems;
}
