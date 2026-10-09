import test from 'node:test';
import assert from 'node:assert/strict';
import {lowerArtNativeSchema,validateArtResponseConstraints,auditArtNativeSchema} from '../scripts/lib/art-skill-native-schema.mjs';
const schema={type:'object',additionalProperties:false,required:['name','width','child'],properties:{name:{type:'string',minLength:1,maxLength:5,pattern:'^[A-Z]+$'},
  width:{type:'integer',minimum:44,maximum:80},child:{enum:[{kind:'section',sectionId:'preferences',width:'fill'},{kind:'section',sectionId:'actions',width:'fill'}]}}};
test('native conversion types enums and expresses exact object choices without object enums',()=>{
  const converted=lowerArtNativeSchema(schema);assert.deepEqual(auditArtNativeSchema(converted),[]);
  assert.equal(converted.properties.name.minLength,undefined);assert.equal(converted.properties.width.minimum,undefined);
  const child=converted.properties.child;assert.equal(child.anyOf.length,2);assert.equal(child.anyOf[0].additionalProperties,false);
  for(const value of schema.properties.child.enum){validateArtResponseConstraints(value,child);validateArtResponseConstraints(value,schema.properties.child);}
});
test('runtime keeps all ranges, text constraints and business-field rejection after shape conversion',()=>{
  const valid={name:'MINT',width:48,child:schema.properties.child.enum[0]};validateArtResponseConstraints(valid,schema);
  for(const edit of [value=>value.width=43,value=>value.width=81,value=>value.name='TOOLONG',value=>value.name='mint',value=>value.state={},value=>value.child.sectionId='invented']){
    const bad=structuredClone(valid);edit(bad);assert.throws(()=>validateArtResponseConstraints(bad,schema),error=>error.code==='ART_RESPONSE_CONSTRAINT');
  }
});
test('object choices retain exact identity and reject missing/extra keys in both schemas',()=>{
  const native=lowerArtNativeSchema(schema.properties.child);
  for(const value of [{kind:'section',sectionId:'preferences'},{kind:'section',sectionId:'preferences',width:'fill',extra:true},{kind:'column',sectionId:'preferences',width:'fill'}])
    for(const constraints of [schema.properties.child,native])assert.throws(()=>validateArtResponseConstraints(value,constraints),error=>error.code==='ART_RESPONSE_CONSTRAINT');
});
test('the local audit detects the original unsupported shape instead of claiming remote readiness',()=>{
  const problems=auditArtNativeSchema(schema);assert(problems.some(value=>value.includes('missing explicit type')));assert(problems.some(value=>value.includes('object enum')));
  assert.throws(()=>lowerArtNativeSchema({}),/ART_NATIVE_SCHEMA_UNSUPPORTED/);
});
