import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {readSafe,hash,json,noLinks,verifySkinPackage} from './package.mjs';
import {materializeMaterialAtlas} from './material-atlas.mjs';
import {extendSkinMaterials} from './materials.mjs';

const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw Object.assign(Error('material-atlas.input-binding'),{code:'skin.material-atlas-input'});};

// Freeze the extra sheet alongside the four component sources. The task inventory
// binds these bytes to its immutable request before any deterministic processing.
export async function freezeMaterialAtlasInput({intake,directory}){
 const node=intake.summary.nodes.find(n=>n.sheetId==='S05');
 if(!node)return null;
 const sources=intake.materialSources??[],source=sources.find(s=>s.sheetId==='S05');
 if(sources.length!==1||!source||!source.raw||hash(source.raw)!==source.sha256||source.sha256!==node.rawSha256||source.planSha256!==node.planSha256||!source.template?.bytes||hash(source.template.bytes)!==source.template.sha256||!digest(node.planSha256))fail();
 const planBytes=intake.evidence?.find(e=>e.file==='plans/'+node.planSha256+'/plan.json')?.bytes;
 if(!planBytes||hash(planBytes)!==node.planSha256)fail();
 const plan=JSON.parse(planBytes),resource=plan.resources?.find(r=>r.file==='inputs/material-template.json');
 if(plan.sheetId!=='S05'||plan.purpose!=='material-atlas'||plan.bindings?.materialTemplateSha256!==source.template.sha256||resource?.sha256!==source.template.sha256||resource?.bytes!==source.template.bytes.length)fail();
 await noLinks(directory);await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'source.png'),source.raw,{flag:'wx'});
 await writeFile(join(directory,'template.json'),source.template.bytes,{flag:'wx'});
 const descriptor={kind:'ui_skin_material_atlas_input',version:'1.0',sheetId:'S05',planSha256:source.planSha256??node.planSha256,
  raw:{file:'source.png',sha256:source.sha256},template:{file:'template.json',sha256:source.template.sha256}};
 const file=join(directory,'material-atlas.json');await writeFile(file,json(descriptor),{flag:'wx'});
 return file;
}

export async function readMaterialAtlasInput(file){
 const base=dirname(file),name=file.split(/[\\/]/).at(-1),bytes=await readSafe(base,name),input=JSON.parse(bytes);
 if(input.kind!=='ui_skin_material_atlas_input'||input.version!=='1.0'||input.sheetId!=='S05'||!digest(input.planSha256)||Object.keys(input).some(k=>!['kind','version','sheetId','planSha256','raw','template'].includes(k)))fail();
 for(const record of [input.raw,input.template])if(!record||!digest(record.sha256)||Object.keys(record).some(k=>!['file','sha256'].includes(k)))fail();
 const raw=await readSafe(base,input.raw.file),templateBytes=await readSafe(base,input.template.file);
 if(hash(raw)!==input.raw.sha256||hash(templateBytes)!==input.template.sha256)fail();
 const template={spec:JSON.parse(templateBytes),bytes:templateBytes,sha256:input.template.sha256};
 return {input,inputSha256:hash(bytes),raw,template};
}

// Called after the thirty base parts are packaged and before the single consumer
// build/check. The source package remains immutable; the candidate includes both.
export async function buildMaterialAtlasPackage({packageDirectory,inputPath,output}){
 const source=await readMaterialAtlasInput(inputPath),skin=await verifySkinPackage(packageDirectory);
 await noLinks(output);await mkdir(output,{recursive:true});
 const extracted=await materializeMaterialAtlas({raw:source.raw,template:source.template,sourceSkinSha256:skin.manifestSha256,rawSha256:source.input.raw.sha256,pack:skin.pack,output:join(output,'extracted')});
 const extended=await extendSkinMaterials({packageDirectory,configPath:extracted.configPath,output:join(output,'extension')});
 if((await readMaterialAtlasInput(inputPath)).inputSha256!==source.inputSha256)fail();
 return {...extended,inputSha256:source.inputSha256,rawSha256:source.input.raw.sha256,templateSha256:source.template.sha256,planSha256:source.input.planSha256,extractionDirectory:extracted.directory,materials:extracted.spec.materials.length,
  ...(extracted.report.derivedSource?{derivedSourceSha256:extracted.report.derivedSource.sha256,normalization:extracted.report.normalization}:{})};
}
