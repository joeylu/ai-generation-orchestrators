import {readSafe,hash} from '../skins/package.mjs';
export async function studioStyles(root,snapshot){
 const config=JSON.parse(await readSafe(root,'configs/studio-styles.json'));
 const entries=[];
 for(const e of config.entries){
  if(!/^[a-z][a-z0-9-]+$/.test(e.id)||!e.image.startsWith('assets/studio-styles/'))throw Error('STUDIO_STYLE_INVALID');
  const bytes=await readSafe(root,e.image);if(hash(bytes)!==e.sha256)throw Error('STUDIO_STYLE_CHANGED');
  const url='/styles/'+e.id+'.png';snapshot.files.set(url.slice(1),bytes);entries.push({...e,image:url});
 }
 snapshot.files.set('styles.json',Buffer.from(JSON.stringify({version:config.version,entries})));
 return entries;
}
export async function resolveStyle(root,project){
 if(!project.style)return null;
 const {entries}=JSON.parse(await readSafe(root,'configs/studio-styles.json'));
 const e=entries.find(s=>s.id===project.style.id&&s.revision===project.style.revision);
 if(!e||e.sha256!==project.reference.sha256||hash(await readSafe(root,e.image))!==e.sha256)throw Error('STUDIO_STYLE_CHANGED');
 return e;
}
