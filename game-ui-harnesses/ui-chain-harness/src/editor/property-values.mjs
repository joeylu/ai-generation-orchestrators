// Empty optional overrides mean absence. Explicit null/default-bearing fields
// still use their schema-specific reader, and nonempty input is never repaired.
export function readPropertyInput(schema,{required=false,raw,read}){
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 if(!required&&!Object.hasOwn(schema,'default')&&!types.includes('null')&&typeof raw==='string'&&raw.trim()==='')return undefined;
 return read();
}
