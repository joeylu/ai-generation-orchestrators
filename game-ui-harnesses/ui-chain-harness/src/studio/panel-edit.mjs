import {panelEditSourceFromSnapshot} from './panel-edit-source.mjs';
import {createPanelRevisionStore} from './panel-revisions.mjs';
import {createHash} from 'node:crypto';

// Resolve only artifacts already admitted to the verified Studio snapshot.
export function panelEditController(root,snapshot){
 const cache=new Map();
 const resolveSource=artifactId=>{
  // Deleting or archiving a catalog entry revokes editing immediately, even
  // while its immutable preview bytes remain in the in-memory file snapshot.
  if(!snapshot?.items?.some(item=>item.id===artifactId&&item.type==='panel')){
   cache.delete(artifactId);return panelEditSourceFromSnapshot(snapshot,artifactId);
  }
  const bytes=snapshot.files.get('artifacts/'+artifactId+'/preview.html');
  const sha256=bytes?createHash('sha256').update(bytes).digest('hex'):null;
  const previous=cache.get(artifactId);
  if(previous?.bytes===bytes&&previous.sha256===sha256)return previous.source;
  const source=panelEditSourceFromSnapshot(snapshot,artifactId);cache.set(artifactId,{bytes,sha256,source});return source;
 };
 const store=createPanelRevisionStore(root,resolveSource);
 return async(action,data)=>{
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('PANEL_EDIT_REQUEST_INVALID');
  const allowed=action==='source'?['artifactId']:action==='load'?['artifactId','variantKey']:action==='save'?['artifactId','variantKey','sourceSha256','expectedRevision','document']:[];
  if(!allowed.length||Object.keys(data).some(k=>!allowed.includes(k)))throw Error('PANEL_EDIT_REQUEST_INVALID');
  if(action==='source')return resolveSource(data.artifactId);
  return store[action](data);
 };
}
