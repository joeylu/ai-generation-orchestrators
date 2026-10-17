import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {parseArgs,promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const exec=promisify(execFile),chainPath='game-ui-harnesses/ui-chain-harness';
const contractPath=chainPath+'/release/component-contract.json';
const registryPath=chainPath+'/configs/component-registry.draft.json';
const packagePath=chainPath+'/package.json';
const lockPath=chainPath+'/package-lock.json';
const defaultTag='ui-chain-components-v0.1.0-rc.3';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const fail=(message,code='components.release')=>{throw Object.assign(Error(message),{code});};
const digest=/^[a-f0-9]{64}$/,commitDigest=/^[a-f0-9]{40}$/;
function safePath(path){return typeof path==='string'&&path.length>0&&!path.includes('\\')&&!/[\x00-\x1f\x7f]/.test(path)&&!path.startsWith('/')&&!/^[A-Za-z]:/.test(path)&&path.split('/').every(p=>p!=='.'&&p!=='..'&&p!=='');}
function within(base,path){const part=relative(base,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);}
function excluded(path){
 const parts=path.split('/');
 if(parts.some(p=>['work','generated','node_modules','.git','.codex','.agents','.ai-frame-animation','.ai-image-background-removal','test-results','coverage','__pycache__'].includes(p)||p==='.env'||p.startsWith('.env.')))return true;
 const preview=parts.indexOf('previews');
 return preview>=0&&!parts.slice(0,preview).some(p=>['archive','assets','fixtures','tests','examples'].includes(p));
}
async function git(repository,args,options={}){
  return (await exec('git',['-c','safe.directory='+repository,'-c','core.autocrlf=false','-c','core.eol=lf','-C',repository,...args],{encoding:'buffer',maxBuffer:64*1024*1024,windowsHide:true,...options})).stdout;
}
async function noLinkedParents(base,target){
 if(!within(base,target))fail('Output must be below this Harness work directory.','components.release-path');
 const pathParts=relative(base,target).split(sep).filter(Boolean);let path=base;
 for(const name of ['',...pathParts]){
  if(name)path=join(path,name);
  try{const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())fail('Output parent must be an ordinary directory.','components.release-path');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
function readPax(bytes){
 const fields={};let at=0;
 while(at<bytes.length){const space=bytes.indexOf(32,at);if(space<0)fail('Invalid archive metadata.');const length=Number(bytes.toString('ascii',at,space));if(!Number.isSafeInteger(length)||length<=space-at+2||at+length>bytes.length||bytes[at+length-1]!==10)fail('Invalid archive metadata.');const record=bytes.toString('utf8',space+1,at+length-1),equal=record.indexOf('=');if(equal<1)fail('Invalid archive metadata.');fields[record.slice(0,equal)]=record.slice(equal+1);at+=length;}
 return fields;
}
/** Inspect the actual Git-produced archive without extracting or trusting member paths. */
export function inspectComponentsArchive(bytes,tag){
 let tar;try{tar=gunzipSync(bytes,{maxOutputLength:512*1024*1024});}catch{fail('Source archive is not a bounded gzip archive.');}
 const files=new Map(),folded=new Set();let at=0,global={},next={};
 const string=(header,start,length)=>{const end=header.indexOf(0,start);return header.toString('utf8',start,end<0||end>start+length?start+length:end);};
 while(at+512<=tar.length){
  const header=tar.subarray(at,at+512);if(header.every(byte=>byte===0)){if(!tar.subarray(at).every(byte=>byte===0))fail('Unexpected data after archive end.');break;}
  const checksum=Number.parseInt(string(header,148,8).trim(),8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];if(checksum!==sum)fail('Invalid tar header checksum.');
  const length=Number.parseInt(string(header,124,12).trim(),8);if(!Number.isSafeInteger(length)||length<0||at+512+length>tar.length)fail('Invalid archive entry size.');
  const data=tar.subarray(at+512,at+512+length),type=String.fromCharCode(header[156]||48);at+=512+Math.ceil(length/512)*512;
  if(type==='g'){global={...global,...readPax(data)};continue;}
  if(type==='x'){next=readPax(data);continue;}
  const prefix=string(header,345,155),name=string(header,0,100),path=next.path??global.path??(prefix?prefix+'/'+name:name);next={};
  const plain=path.endsWith('/')?path.slice(0,-1):path;if(!safePath(plain)||!plain.startsWith(tag+'/')&&plain!==tag)fail('Unsafe source archive member.');
  if(type==='5')continue;
  if(type!=='0')fail('Source archives cannot contain links or special files.');
  const file=path.slice(tag.length+1);if(!safePath(file)||excluded(file)||folded.has(file.toLowerCase()))fail('Excluded or duplicate source archive member.');
  folded.add(file.toLowerCase());files.set(file,Buffer.from(data));
 }
 if(!files.size||at>tar.length)fail('Empty or truncated source archive.');
 return files;
}

export async function packageComponentsRelease({repository=resolve(fileURLToPath(new URL('../../../',import.meta.url))),commit='HEAD',tag,outputRoot}={}){
 repository=await realpath(resolve(repository));
 const validTag=value=>/^ui-chain-components-v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(value);
 if(tag!==undefined&&!validTag(tag))fail('Use an immutable ui-chain-components version tag.');
 if(typeof commit!=='string'||!commit||/[\x00-\x20\x7f]/.test(commit))fail('Invalid commit reference.');
 const top=(await git(repository,['rev-parse','--show-toplevel'])).toString('utf8').trim();if(resolve(top)!==repository)fail('Repository must be its Git root.');
 const sourceCommit=(await git(repository,['rev-parse','--verify','--end-of-options',commit+'^{commit}'])).toString('utf8').trim();if(!commitDigest.test(sourceCommit))fail('Expected a committed Git SHA-1 object.');
 const tree=(await git(repository,['ls-tree','-r','-z','--full-tree',sourceCommit])).toString('utf8').split('\0').filter(Boolean).map(record=>{
  const match=/^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);if(!match||!safePath(match[3]))fail('Source commit contains unsafe paths, links or submodules.');return {file:match[3],gitBlob:match[2]};
 });
 const omitted=tree.filter(row=>excluded(row.file)).map(row=>row.file),source=tree.filter(row=>!excluded(row.file));
 const sourceFile=async path=>{if(!source.some(row=>row.file===path))fail('Required committed release input is missing: '+path);return git(repository,['show',sourceCommit+':'+path]);};
 const contractBytes=await sourceFile(contractPath),contract=JSON.parse(contractBytes),registry=JSON.parse(await sourceFile(registryPath)),pkg=JSON.parse(await sourceFile(packagePath)),lockBytes=await sourceFile(lockPath);
 if(!contract||typeof contract.kind!=='string'||typeof contract.version!=='string')fail('Invalid component API contract.');
 tag??=contract.releaseTag??defaultTag;
 if(!validTag(tag)||contract.releaseTag!==undefined&&contract.releaseTag!==tag)fail('Version tag differs from the committed component API contract.');
 const types=registry.recipes?.map(recipe=>recipe.type);if(!Array.isArray(types)||types.length!==16||new Set(types).size!==16||types.some(type=>typeof type!=='string'))fail('Release requires all 16 registered component types.');
 if(typeof pkg.engines?.node!=='string'||!pkg.dependencies?.playwright||!pkg.devDependencies?.esbuild||!pkg.devDependencies?.['@fontsource/noto-sans-sc'])fail('Component build requirements are incomplete.');
 const harness=join(repository,chainPath),work=join(harness,'work');outputRoot=resolve(harness,outputRoot??'work/releases');
 await noLinkedParents(harness,work);await noLinkedParents(work,outputRoot);await mkdir(outputRoot,{recursive:true});await noLinkedParents(work,outputRoot);
 const directory=join(outputRoot,randomUUID());await mkdir(directory);
 const archiveFile=tag+'-source.tar.gz',archivePath=join(directory,archiveFile);
 await git(repository,['archive','--format=tar.gz','--prefix='+tag+'/','--output='+archivePath,sourceCommit,'--','.',...omitted.map(path=>':(exclude,literal)'+path)]);
 const archive=await readFile(archivePath),files=inspectComponentsArchive(archive,tag);
 if(files.size!==source.length||source.some(row=>!files.has(row.file)))fail('Source archive differs from the committed allowlist.');
 for(const row of source){const bytes=files.get(row.file),blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');if(blob!==row.gitBlob)fail('Archive bytes differ from the committed Git blob: '+row.file);}
 if(!files.get(contractPath)?.equals(contractBytes))fail('Archive API contract changed.');
 const receipt={kind:'ui_chain_components_release',version:'1.0',tag,commit:sourceCommit,componentOnly:true,scope:{end:'16-component-output',components:16,types,panelGeneration:false,panelApi:false},providerNeutral:true,automaticRetries:0,modelCalls:0,productionReady:false,visualAcceptance:'unreviewed',archive:{file:archiveFile,sha256:sha(archive),bytes:archive.length,prefix:tag+'/'},apiContract:{file:'component-contract.json',sourcePath:contractPath,sha256:sha(contractBytes),bytes:contractBytes.length,kind:contract.kind,version:contract.version},requirements:{node:pkg.engines.node,npm:'npm ci --ignore-scripts --include=dev',browser:{package:'playwright',version:pkg.dependencies.playwright,channel:'chromium',explicitSetup:'npx playwright install --with-deps chromium',automaticDownload:false},python:false,panelSdk:false,font:{package:'@fontsource/noto-sans-sc',version:pkg.devDependencies['@fontsource/noto-sans-sc']},build:{package:'esbuild',version:pkg.devDependencies.esbuild}},packageLockSha256:sha(lockBytes),source:{mode:'committed-git-archive',worktreeRead:false,omitted,files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([file,bytes])=>({file,bytes:bytes.length,sha256:sha(bytes)}))}};
 await writeFile(join(directory,'component-contract.json'),contractBytes,{flag:'wx'});
 const receiptBytes=Buffer.from(json(receipt));await writeFile(join(directory,'component-release.json'),receiptBytes,{flag:'wx'});
 const sums=[[archiveFile,archive],['component-contract.json',contractBytes],['component-release.json',receiptBytes]].map(([file,bytes])=>sha(bytes)+'  '+file+'\n').join('');await writeFile(join(directory,'SHA256SUMS'),sums,{flag:'wx'});
 await verifyComponentsRelease(directory);
 return {status:'packaged',directory,tag,commit:sourceCommit,archive:archiveFile,archiveSha256:receipt.archive.sha256,sourceFiles:files.size,components:16,modelCalls:0,productionReady:false};
}

export async function verifyComponentsRelease(directory){
 directory=resolve(directory);
 const read=async file=>{if(!safePath(file)||file.includes('/'))fail('Unsafe release asset path.');const path=join(directory,file),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())fail('Release assets must be ordinary files.');return readFile(path);};
 const receiptBytes=await read('component-release.json'),receipt=JSON.parse(receiptBytes);
 if(receipt.kind!=='ui_chain_components_release'||receipt.version!=='1.0'||!commitDigest.test(receipt.commit)||receipt.componentOnly!==true||receipt.scope?.components!==16||receipt.scope?.panelGeneration!==false||receipt.productionReady!==false||receipt.providerNeutral!==true||!digest.test(receipt.archive?.sha256)||!digest.test(receipt.apiContract?.sha256))fail('Invalid component release receipt.');
 const archive=await read(receipt.archive.file),contract=await read(receipt.apiContract.file);
 if(sha(archive)!==receipt.archive.sha256||archive.length!==receipt.archive.bytes||sha(contract)!==receipt.apiContract.sha256||contract.length!==receipt.apiContract.bytes)fail('Release asset digest changed.','components.release-integrity');
 const files=inspectComponentsArchive(archive,receipt.tag),expected=receipt.source?.files;
 if(!Array.isArray(expected)||files.size!==expected.length||new Set(expected.map(row=>row.file)).size!==expected.length)fail('Source archive file coverage changed.','components.release-integrity');
 for(const row of expected){const bytes=files.get(row.file);if(!bytes||sha(bytes)!==row.sha256||bytes.length!==row.bytes)fail('Source archive file digest changed.','components.release-integrity');}
 if(!files.get(receipt.apiContract.sourcePath)?.equals(contract)||sha(files.get(lockPath)??Buffer.alloc(0))!==receipt.packageLockSha256)fail('Source contract or lock identity changed.','components.release-integrity');
 const checksums=(await read('SHA256SUMS')).toString('utf8');
 const expectedSums=[[receipt.archive.file,archive],[receipt.apiContract.file,contract],['component-release.json',receiptBytes]].map(([file,bytes])=>sha(bytes)+'  '+file+'\n').join('');if(checksums!==expectedSums)fail('Release checksum list changed.','components.release-integrity');
 return {status:'verified',directory,tag:receipt.tag,commit:receipt.commit,archiveSha256:receipt.archive.sha256,components:16,sourceFiles:files.size,modelCalls:0,productionReady:false};
}

export async function main(args=process.argv.slice(2)){
 const {positionals,values}=parseArgs({args,allowPositionals:true,options:{commit:{type:'string'},tag:{type:'string'},out:{type:'string'},directory:{type:'string'}}});
 const action=positionals[0]??'build';if(positionals.length>1||!['build','verify'].includes(action))fail('Use build [--commit HEAD] [--tag ui-chain-components-v0.1.0-rc.3] [--out work/releases] | verify --directory <release-directory>.');
 if(action==='verify'){if(!values.directory||values.commit||values.tag||values.out)fail('Verify requires only --directory.');return verifyComponentsRelease(values.directory);}
 if(values.directory)fail('Build does not accept --directory.');return packageComponentsRelease({commit:values.commit,tag:values.tag,outputRoot:values.out});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(json(await main()));}catch(error){console.error(json({status:'failed',code:error.code??'components.release',message:error.message,modelCalls:0}));process.exitCode=1;}
}
