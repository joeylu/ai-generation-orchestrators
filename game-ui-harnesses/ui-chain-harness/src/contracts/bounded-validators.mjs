import Ajv from 'ajv';

// Ajv retains generated functions in its code-generation scope even after
// removeSchema. Each dynamic schema therefore owns a disposable compiler;
// equal JSON content reuses the validator and LRU eviction releases the whole
// compiler. The long-lived meta validator only validates schemas as data.
export function boundedValidators(options,{maxEntries=128}={}){
 if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>4096)throw new RangeError('Invalid validator cache capacity.');
 const meta=new Ajv(options),entries=new Map();
 const release=entry=>entry.compiler.removeSchema(entry.schema);
 return {
  get size(){return entries.size;},
  compile(schema){
   // Preserve object-property order: default insertion order is observable in
   // frozen JSON output. Clone by content so later author edits cannot mutate
   // an existing schema or make Ajv return a stale identity-cached validator.
   const key=JSON.stringify(schema),cached=entries.get(key);
   if(cached){entries.delete(key);entries.set(key,cached);return cached.validate;}
   const frozen=JSON.parse(key);
   if(options?.validateSchema!==false)meta.validateSchema(frozen,true);
   const compiler=new Ajv({...options,validateSchema:false});
   let validate;
   try{validate=compiler.compile(frozen);}
   catch(error){if(frozen&&typeof frozen==='object')compiler.removeSchema(frozen);throw error;}
   // Boolean schemas are valid JSON Schema, but Ajv.removeSchema accepts only
   // objects/keys. They have just two possible values and require no registry.
   const entry={schema:frozen,compiler,validate};
   entries.set(key,entry);
   while(entries.size>maxEntries){const oldest=entries.keys().next().value,retired=entries.get(oldest);entries.delete(oldest);if(typeof retired.schema==='object')release(retired);}
   return validate;
  },
  clear(){for(const entry of entries.values())if(typeof entry.schema==='object')release(entry);entries.clear();},
 };
}
