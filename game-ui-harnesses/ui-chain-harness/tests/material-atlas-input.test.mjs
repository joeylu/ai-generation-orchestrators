import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readMaterialTemplate,materialTemplateImages} from '../src/skin-generation/material-template.mjs';
import {freezeMaterialAtlasInput,readMaterialAtlasInput,buildMaterialAtlasPackage} from '../src/skins/material-atlas-input.mjs';
import {hash,json,verifySkinPackage} from '../src/skins/package.mjs';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {decodePng,encodePng} from '../src/skins/png.mjs';

async function setup(fn){
 const directory=await mkdtemp(join(tmpdir(),'material-atlas-input-'));
 try{
  const template=await readMaterialTemplate(),raw=materialTemplateImages(template.spec).clean;
  const planBytes=Buffer.from(json({sheetId:'S05',purpose:'material-atlas',bindings:{materialTemplateSha256:template.sha256},resources:[{file:'inputs/material-template.json',sha256:template.sha256,bytes:template.bytes.length}]}));
  const source={sheetId:'S05',raw,sha256:hash(raw),planSha256:hash(planBytes),template};
  const intake={summary:{nodes:[{sheetId:'S05',planSha256:source.planSha256,rawSha256:source.sha256,status:'received'}]},materialSources:[source],evidence:[{file:'plans/'+source.planSha256+'/plan.json',bytes:planBytes}]};
  await fn({directory,intake,source});
 }finally{await rm(directory,{recursive:true,force:true});}
}

test('material source and template are frozen together; old four-sheet input adds no stage',async()=>setup(async({directory,intake,source})=>{
 assert.equal(await freezeMaterialAtlasInput({intake:{summary:{nodes:[]}},directory:join(directory,'unused')}),null);
 const file=await freezeMaterialAtlasInput({intake,directory:join(directory,'input')});
 const read=await readMaterialAtlasInput(file);
 assert.deepEqual(read.raw,source.raw);assert.deepEqual(read.template.spec,source.template.spec);
 await writeFile(join(directory,'input/source.png'),'changed');
 await assert.rejects(()=>readMaterialAtlasInput(file),/input-binding/);
}));

test('five-sheet completion cannot omit the material evidence or substitute unsafe references',async()=>setup(async({directory,intake})=>{
 await assert.rejects(()=>freezeMaterialAtlasInput({intake:{...intake,materialSources:[]},directory:join(directory,'missing')}),/input-binding/);
 await assert.rejects(()=>freezeMaterialAtlasInput({intake:{...intake,materialSources:intake.materialSources.map(s=>({...s,planSha256:'b'.repeat(64)}))},directory:join(directory,'substituted')}),/input-binding/);
 const file=await freezeMaterialAtlasInput({intake,directory:join(directory,'input')});
 const record=JSON.parse(await readFile(file));record.raw.file='../outside.png';await writeFile(file,json(record));
 await assert.rejects(()=>readMaterialAtlasInput(file));
}));

test('received atlas becomes a verified skin extension without changing any base assets',async()=>setup(async({directory,intake})=>{
 const fixture=await materialSkinFixture(join(directory,'fixture')),before=await verifySkinPackage(fixture.packageDirectory);
 const file=await freezeMaterialAtlasInput({intake,directory:join(directory,'input')});
 const result=await buildMaterialAtlasPackage({packageDirectory:fixture.packageDirectory,inputPath:file,output:join(directory,'candidate')});
 const next=await verifySkinPackage(result.packageDirectory);
 assert.equal(result.materials,3);assert.equal(result.modelCalls,0);
 assert.equal(next.pack.materialAssets.length,3);
 assert.deepEqual(Object.keys(next.pack.surfaceStyles).sort(),['panel','section','title']);
 for(const asset of before.pack.assets)assert.deepEqual(next.pack.assets.find(a=>a.assetId===asset.assetId),asset);
 for(const [name,bytes]of before.resources)assert.deepEqual(next.resources.get(name),bytes);
 assert.equal(next.pack.surfaceStyles.title.baseMode,'replace');
 assert.equal(next.pack.surfaceStyles.panel.layers[0].mode,'tile');
 assert.equal((await verifySkinPackage(fixture.packageDirectory)).manifestSha256,before.manifestSha256);
}));

test('dirty-alpha frozen raw remains unchanged while a derived normalized source enters the verified skin package',async()=>setup(async({directory,intake,source})=>{
 const dirty=decodePng(source.raw);dirty.pixels.set([20,40,60,0],0);source.raw=encodePng(dirty);source.sha256=hash(source.raw);intake.summary.nodes[0].rawSha256=source.sha256;
 const fixture=await materialSkinFixture(join(directory,'fixture')),file=await freezeMaterialAtlasInput({intake,directory:join(directory,'input')}),frozen=await readMaterialAtlasInput(file),before=Buffer.from(frozen.raw);
 const result=await buildMaterialAtlasPackage({packageDirectory:fixture.packageDirectory,inputPath:file,output:join(directory,'candidate')}),next=await verifySkinPackage(result.packageDirectory),report=JSON.parse(await readFile(join(result.extractionDirectory,'report.json')));
 assert.equal(result.rawSha256,source.sha256);assert.equal(result.derivedSourceSha256,report.derivedSource.sha256);assert.equal(result.normalization.changedInvisibleRgbPixels,1);
 assert.deepEqual((await readMaterialAtlasInput(file)).raw,before);assert.deepEqual(await readFile(join(result.extractionDirectory,'source.png')),before);
 for(const material of next.pack.materialAssets){assert.equal(material.source.sha256,result.derivedSourceSha256);assert.equal(decodePng(next.resources.get(material.source.file)).transparentRgbPixels,0);}
 assert.equal(next.pack.materialAssets.length,3);assert.equal(result.modelCalls,0);
}));
