import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {boundedValidators} from '../src/contracts/bounded-validators.mjs';
import {readContracts,validateContracts} from '../src/contracts/validate.mjs';
import {validateProps} from '../src/contracts/props.mjs';
import {defaults} from '../src/contracts/build.mjs';
const options={allErrors:true,strict:true,strictRequired:true};

test('equal JSON schemas reuse their validator, while edits to the same input object take effect without changing prior validators',()=>{
 const cache=boundedValidators(options),schema={type:'string',minLength:1},a=cache.compile(schema);
 assert.equal(cache.compile(structuredClone(schema)),a);schema.minLength=3;
 const b=cache.compile(schema);assert.notEqual(b,a);assert.equal(a('ab'),true);assert.equal(b('ab'),false);assert.equal(cache.size,2);
 schema.minLength=1;assert.equal(cache.compile(schema),a);cache.clear();assert.equal(cache.size,0);assert.equal(a('ab'),true);
});

test('default insertion stays isolated per option set, preserves order and never shares mutable default data',()=>{
 const fill=boundedValidators({...options,useDefaults:true}),check=boundedValidators(options),schema={type:'object',additionalProperties:false,properties:{z:{type:'array',items:{type:'string'},default:['one']},a:{type:'string',default:'two'}}};
 const a=fill.compile(schema),b=check.compile(schema),one={},two={},plain={};assert.notEqual(a,b);assert(a(one));assert(b(plain));assert.deepEqual(plain,{});assert.deepEqual(Object.keys(one),['z','a']);one.z.push('changed');assert(a(two));assert.deepEqual(two,{z:['one'],a:'two'});assert.deepEqual(schema.properties.z.default,['one']);
 const reversed={...schema,properties:{a:schema.properties.a,z:schema.properties.z}},other={};assert.notEqual(fill.compile(reversed),a);assert(fill.compile(reversed)(other));assert.deepEqual(Object.keys(other),['a','z']);
});

test('LRU eviction removes schemas from their own Ajv compiler and releases the bounded entry rather than only a wrapper map',()=>{
 const original=Ajv.prototype.removeSchema,retired=[];Ajv.prototype.removeSchema=function(schema){retired.push({compiler:this,schema});return original.call(this,schema);};
 try{
  const cache=boundedValidators(options,{maxEntries:2}),schema=n=>({type:'number',minimum:n}),a=cache.compile(schema(0)),b=cache.compile(schema(1));
  assert.equal(cache.compile(schema(0)),a);cache.compile(schema(2));assert.equal(cache.size,2);assert.equal(retired.length,1);assert.deepEqual(retired[0].schema,schema(1));assert.equal(retired[0].compiler._cache.has(retired[0].schema),false);
  assert.notEqual(cache.compile(schema(1)),b);assert.equal(cache.size,2);cache.clear();assert.equal(cache.size,0);assert.equal(retired.length,4);assert.equal(a(0),true);
 }finally{Ajv.prototype.removeSchema=original;}
});

test('meta-schema, strict, local refs, missing external refs and boolean schemas retain ordinary Ajv behavior',()=>{
 const cache=boundedValidators(options,{maxEntries:2});
 assert.throws(()=>cache.compile({type:7}),/schema is invalid/);assert.throws(()=>cache.compile({type:'object',required:['absent'],additionalProperties:false,properties:{}}),/strictRequired/);
 const schema={type:'object',additionalProperties:false,definitions:{word:{type:'string',minLength:2}},properties:{value:{$ref:'#/definitions/word'}}},check=cache.compile(schema);assert(check({value:'ok'}));assert.equal(check({value:'x'}),false);
 assert.throws(()=>cache.compile({$ref:'https://example.invalid/missing-public-schema.json'}),/resolve reference/);assert.equal(cache.size,1);assert(cache.compile(true)(null));assert.equal(cache.compile(false)(null),false);cache.clear();assert.equal(cache.size,0);
});

test('component contracts still reject external schema references and changed defaults are visible in props validation',async()=>{
 const inputs=await readContracts(defaults),registry=structuredClone(inputs.registry),text=registry.recipes.find(r=>r.type==='Text'),ref=text.recipeId+'@'+text.recipeVersion;
 const original=validateProps(registry,ref,{text:'source',textStyleRef:'body'});assert.deepEqual(original.issues,[]);
 text.propsSchema.properties.text.default='first';assert.equal(validateProps(registry,ref,{textStyleRef:'body'}).props.text,'first');text.propsSchema.properties.text.default='second';assert.equal(validateProps(registry,ref,{textStyleRef:'body'}).props.text,'second');
 for(const key of ['$ref','$id']){const copy=structuredClone(inputs);copy.registry.recipes[0].propsSchema[key]='urn:external';assert(validateContracts(copy).issues.some(i=>i.code==='schema.additionalProperties'));}
});

test('200 offline status-equivalent contract reads stay stable in one small-heap process',async t=>{
 const child=await promisify(execFile)(process.execPath,['--expose-gc','--max-old-space-size=96','--input-type=module','-e',`
  import {readContracts} from './src/contracts/validate.mjs';
  import {validateProps,recipeRef} from './src/contracts/props.mjs';
  import {defaults} from './src/contracts/build.mjs';
  let warm=0,last=0;for(let i=0;i<200;i++){
   const input=await readContracts(defaults);if(input.issues.length)throw Error('contract changed');
   for(const recipe of input.registry.recipes)validateProps(input.registry,recipeRef(recipe),{},{});
   if(i===19||i===199){global.gc();if(i===19)warm=process.memoryUsage().heapUsed;else last=process.memoryUsage().heapUsed;}
  }
  if(last-warm>12*1024*1024||last>80*1024*1024)throw Error('unbounded validation heap growth');
  console.log(JSON.stringify({rounds:200,warmHeapBytes:warm,finalHeapBytes:last,growthBytes:last-warm}));
 `],{cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,timeout:60000,maxBuffer:1024*1024});
 const proof=JSON.parse(child.stdout);assert.equal(proof.rounds,200);assert(proof.growthBytes<=12*1024*1024);assert.equal(child.stderr,'');t.diagnostic(JSON.stringify(proof));
});
