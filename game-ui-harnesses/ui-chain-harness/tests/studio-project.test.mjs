import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceRecord,validateProject} from '../src/studio/project.mjs';
test('portable Studio input roundtrip binds exact image bytes without trusting state',async()=>{
 const reference=await referenceRecord(Uint8Array.from([137,80,78,71,13,10,26,10,1]));
 const project={kind:'ui_studio_project_draft',version:'0.1',name:' 森林 ',description:'木纹',reference};
 const restored=await validateProject(JSON.parse(JSON.stringify(project)));assert.equal(restored.name,'森林');assert.equal(restored.reference.sha256,reference.sha256);
 await assert.rejects(()=>validateProject({...project,reference:{...reference,sha256:'0'.repeat(64)}}),/校验失败/);
 await assert.rejects(()=>validateProject({...project,status:'passed'}),/不支持/);
 await assert.rejects(()=>validateProject({...project,name:''}),/名称/);
 await assert.rejects(()=>referenceRecord(new TextEncoder().encode('<svg></svg>')),/PNG/);
});

test('material generation is an optional portable boolean and old drafts stay unchanged',async()=>{
 const reference=await referenceRecord(Uint8Array.from([137,80,78,71,13,10,26,10,1]));
 const base={kind:'ui_studio_project_draft',version:'0.1',name:'材质',description:'',reference};
 assert.equal(Object.hasOwn(await validateProject(base),'materialGeneration'),false);
 for(const materialGeneration of [true,false])assert.equal((await validateProject({...base,materialGeneration})).materialGeneration,materialGeneration);
 for(const materialGeneration of ['true',1,null])await assert.rejects(()=>validateProject({...base,materialGeneration}),/材质生成配置/);
});
