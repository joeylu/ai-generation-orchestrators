import {crc32} from '../skins/png.mjs';
import {hash} from '../skins/package.mjs';
const fail=message=>{throw Object.assign(Error(message),{code:'panel.sdk-integrity'});};
export function sdkPath(path){
 return typeof path==='string'&&path.length<=240&&/^[A-Za-z0-9_.@/-]+$/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
function fingerprint(bytes,record){if(!bytes||bytes.length!==record?.bytes||hash(bytes)!==record.sha256)fail('Official SDK byte count or SHA-256 differs: '+(record?.file??'resource'));}
export function parseSdkZip(input){
 const bytes=Buffer.from(input),end=bytes.length-22;if(end<0||bytes.length>64*1024*1024||bytes.readUInt32LE(end)!==0x06054b50||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+20))fail('Unsupported SDK ZIP container.');
 const count=bytes.readUInt16LE(end+10),central=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
 if(!count||count>2048||bytes.readUInt16LE(end+8)!==count||central+size!==end)fail('Invalid SDK ZIP index.');
 const files=new Map(),seen=new Set(),locals=[];let at=0;
 for(let i=0;i<count;i++){
  if(at+30>central||bytes.readUInt32LE(at)!==0x04034b50)fail('Invalid SDK ZIP local entry.');
  const flags=bytes.readUInt16LE(at+6),method=bytes.readUInt16LE(at+8),crc=bytes.readUInt32LE(at+14),packed=bytes.readUInt32LE(at+18),length=bytes.readUInt32LE(at+22),n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+n+extra;
  if(![0,0x800].includes(flags)||method!==0||packed!==length||extra||start+length>central)fail('SDK ZIP must use bounded stored regular files.');
  const name=bytes.toString('utf8',at+30,at+30+n);if(!sdkPath(name)||!name.startsWith('package/')||seen.has(name.toLowerCase()))fail('Unsafe or duplicate SDK ZIP path.');
  const data=bytes.subarray(start,start+length);if(crc32(data)!==crc)fail('SDK ZIP CRC differs.');
  files.set(name.slice(8),data);seen.add(name.toLowerCase());locals.push({name,offset:at,length,crc,flags});at=start+length;
 }
 if(at!==central)fail('SDK ZIP has unindexed local bytes.');
 for(const entry of locals){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)fail('Invalid SDK ZIP central entry.');
  const n=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),stop=at+46+n+extra+comment;
  if(stop>end||extra||comment||bytes.readUInt16LE(at+34)||bytes.readUInt16LE(at+10)||bytes.readUInt16LE(at+8)!==entry.flags||bytes.readUInt32LE(at+16)!==entry.crc||bytes.readUInt32LE(at+20)!==entry.length||bytes.readUInt32LE(at+24)!==entry.length||bytes.readUInt32LE(at+42)!==entry.offset||bytes.toString('utf8',at+46,at+46+n)!==entry.name||((bytes.readUInt32LE(at+38)>>>16)&0xf000)===0xa000)fail('SDK ZIP central/local identity differs.');
  at=stop;
 }
 if(at!==end)fail('SDK ZIP index length differs.');
 for(const name of files.keys()){const pieces=name.toLowerCase().split('/');for(let i=1;i<pieces.length;i++)if(seen.has('package/'+pieces.slice(0,i).join('/')))fail('SDK ZIP file/directory collision.');}
 return files;
}
function sums(bytes){
 const map=new Map();for(const line of bytes.toString('utf8').trim().split(/\r?\n/)){const m=/^([a-f0-9]{64})  ([A-Za-z0-9_.@/-]+)$/.exec(line);if(!m||!sdkPath(m[2])||map.has(m[2]))fail('Invalid SDK checksum list.');map.set(m[2],m[1]);}return map;
}
/** Validate the official archive and both independently published sidecars. */
export function verifySdkArchive({archive,receipt,checksums,lock}){
 fingerprint(archive,lock.archive);fingerprint(receipt,lock.receipt);fingerprint(checksums,lock.checksums);
 const published=sums(checksums),r=JSON.parse(receipt);
 if(published.get(lock.archive.file)!==lock.archive.sha256||published.get(lock.receipt.file)!==lock.receipt.sha256||r.version!==lock.packageVersion||r.tag!==lock.tag||r.source?.commit!==lock.commit||r.source?.dirty!==false||r.source?.repository!==lock.repository||r.archive?.file!==lock.archive.file||r.archive?.bytes!==lock.archive.bytes||r.archive?.sha256!==lock.archive.sha256)fail('Official SDK publication receipt differs.');
 const files=parseSdkZip(archive),manifestBytes=files.get(lock.manifest.file);fingerprint(manifestBytes,lock.manifest);const manifest=JSON.parse(manifestBytes),m=manifest.package;
 if(files.size!==lock.packageFiles||manifest.releaseManifestVersion!=='0.1'||m?.name!==lock.name||m.version!==lock.packageVersion||m.tag!==lock.tag||manifest.source?.commit!==lock.commit||manifest.source?.dirty!==false||manifest.source?.repository!==lock.repository||manifest.modelCalls!==0||!Array.isArray(manifest.files)||manifest.files.length!==lock.manifest.files)fail('SDK release manifest differs from the locked release.');
 const internal=sums(files.get('SHA256SUMS')),declared=new Set(['SHA256SUMS',lock.manifest.file]),folded=new Set([...declared].map(p=>p.toLowerCase()));
 for(const file of manifest.files){if(!sdkPath(file.path)||folded.has(file.path.toLowerCase()))fail('SDK manifest has an unsafe or duplicate path.');declared.add(file.path);folded.add(file.path.toLowerCase());fingerprint(files.get(file.path),{...file,file:file.path});}
 if(declared.size!==files.size||[...files.keys()].some(p=>!declared.has(p))||internal.size!==files.size-1||[...files].some(([name,b])=>name!=='SHA256SUMS'&&internal.get(name)!==hash(b)))fail('SDK file inventory/checksum coverage differs.');
 const pkg=JSON.parse(files.get('package.json'));if(pkg.name!==lock.name||pkg.version!==lock.packageVersion||pkg.type!=='module')fail('SDK package identity differs.');
 return {files,manifest,package:pkg};
}
