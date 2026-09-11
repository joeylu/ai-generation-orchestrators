// Local, deterministic fixtures using the current consumer's public contracts.
// No model calls. Original helper fixtures and production deliveries stay untouched.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {inflateSync,deflateSync} from 'node:zlib';
const [root,out]=process.argv.slice(2).map(p=>resolve(p));
await mkdir(out,{recursive:false});
const mod=p=>import(pathToFileURL(resolve(root,p)));
const {appearanceApplicationFixture}=await mod('tests/helpers/appearance-application-fixture.ts');
const {firstBatchAppearanceFixture}=await mod('tests/helpers/first-batch-appearance-fixture.ts');
const {secondBatchAppearanceFixture}=await mod('tests/helpers/second-batch-appearance-fixture.ts');
const {forceZip64Stored}=await mod('tests/helpers/decomposition-fixture.ts');
const {createBundle}=await mod('src/bundle.ts');
const {importDecompositionZip}=await mod('src/decomposition-import.ts');
const {appearanceDocumentSha256}=await mod('src/appearance-binding.ts');
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical)}]`:`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`;
const json=v=>Buffer.from(canonical(v)+'\n');
const crc=b=>{let v=0xffffffff;for(const c of b){v^=c;for(let i=0;i<8;i++)v=(v>>>1)^(v&1?0xedb88320:0);}return (v^0xffffffff)>>>0;};
const chunk=(t,b)=>{const x=Buffer.alloc(b.length+12);x.writeUInt32BE(b.length);x.write(t,4);b.copy(x,8);x.writeUInt32BE(crc(x.subarray(4,-4)),x.length-4);return x;};
function transparent(png,icon=false){
 const b=Buffer.from(png),w=b.readUInt32BE(16),h=b.readUInt32BE(20);let compressed=[];
 for(let i=8;i<b.length;){const n=b.readUInt32BE(i);if(b.toString('ascii',i+4,i+8)==='IDAT')compressed.push(b.subarray(i+8,i+8+n));i+=n+12;}
 const raw=inflateSync(Buffer.concat(compressed));
 // Test fixtures are solid colors: preserve their center, add a transparent border.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const outside=icon&&(((x-(w-1)/2)/((w-2)/2))**2+((y-(h-1)/2)/((h-2)/2))**2>1);
  if(x===0||y===0||x===w-1||y===h-1||outside)raw.fill(0,y*(w*4+1)+1+x*4,y*(w*4+1)+5+x*4);
 }
 return Buffer.concat([b.subarray(0,33),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const cases=[await appearanceApplicationFixture(),await firstBatchAppearanceFixture(),await secondBatchAppearanceFixture()];
for(const caseName of ['Button','Switch','Select','CheckBox','RadioGroup','List','Tabs','Tabs-identical']){
 const kind=caseName.split('-')[0];
 const f=cases.find(f=>f.document.root.children.some(n=>n.type===kind));
 const document=structuredClone(f.document),node=document.root.children.find(n=>n.type===kind);
 document.root.children=[node];
 const binding=structuredClone(f.binding);binding.bindings=binding.bindings.filter(b=>b.componentId===node.id);
 if(kind==='Select')binding.bindings[0].states.select.popupContentLayout={coordinateSpace:'target-popup-local',x:6,y:6,width:108,height:78};
 const scene=structuredClone(f.fixture.scene),delivery=structuredClone(f.fixture.delivery);
 let members=f.fixture.members.map(m=>({name:m.name,bytes:Buffer.from(m.bytes)}));
 if(kind==='Tabs'){
  // Three tabs, preserving the public per-item role and local layout contracts.
  node.layout.width=600;node.props.tabs[0].label='ACTIVE';node.props.tabs[1].label='COMPLETED';
  node.props.tabs.push({id:'tab-c',label:'ARCHIVE',contentId:'content-c'});
  node.children.push({...structuredClone(node.children[0]),id:'content-c'});
  for(const c of node.children)c.layout.width=600;
  const b=binding.bindings[0];b.states.tabs.icons.push({...structuredClone(b.states.tabs.icons[0]),tabId:'tab-c'});
  for(const role of ['icon','active-icon']){
   const source=b.parts.find(p=>p.role===role&&p.tabId==='tab-a');const layerId=source.layerId.replace('tab-a','tab-c');
   b.parts.push({...source,tabId:'tab-c',layerId});
   const layer=scene.tree.flatMap(g=>g.children).find(l=>l.id===source.layerId);
   scene.tree[1].children.push({...layer,id:layerId,name:layerId,asset:layerId,png:`layers/${layerId}.png`,left:layer.left+400});
   members.push({name:`layers/${layerId}.png`,bytes:members.find(m=>m.name===layer.png).bytes});
  }
 }
 const used=new Set(binding.bindings[0].parts.map(p=>p.layerId));
 scene.tree=scene.tree.map(g=>({...g,children:g.children.filter(l=>l.role==='background'||used.has(l.id))}));
 const layers=scene.tree.flatMap(g=>g.children);
 members=members.filter(m=>!m.name.startsWith('layers/')||layers.some(l=>l.png===m.name));
 for(const l of layers){const m=members.find(m=>m.name===l.png);m.bytes=transparent(m.bytes,l.id.endsWith('-icon'));}
 if(caseName==='Tabs-identical')for(const m of members)if(m.name.endsWith('-active-icon.png'))m.bytes=members.find(q=>q.name===m.name.replace('-active-icon.png','-icon.png')).bytes;
 for(const l of layers)l.sha256=hash(members.find(m=>m.name===l.png).bytes);
 const sceneBytes=json(scene);members.find(m=>m.name==='scene.json').bytes=sceneBytes;
 delivery.scene_sha256=hash(sceneBytes);delivery.pixel_layers=layers.length;delete delivery.digest;delivery.digest=hash(Buffer.from(canonical(delivery)));
 members.find(m=>m.name==='delivery.json').bytes=json(delivery);
 const nested=forceZip64Stored(members),imported=await importDecompositionZip(nested);
 const target=await createBundle(document,[],{kind:'programmatic-fixture',description:'Stateful appearance regression. Synthetic local pixels, no generated media.'});
 Object.assign(binding,{documentSha256:await appearanceDocumentSha256(document),deliveryDigest:imported.deliveryDigest,sceneSha256:imported.sceneSha256,archiveSha256:imported.archiveSha256});
 const bundleBytes=json(target),bindingBytes=json(binding);
 const manifest={kind:'ai_ui_component_handoff_v1',status:'contracts_packaged_unreviewed_draft',decomposition:{path:'decomposition/ui.draft.zip',sha256:hash(nested)},component_bundle:{path:'component.ui-bundle.json',sha256:hash(bundleBytes)},appearance_binding:{path:'appearance-binding.json',sha256:hash(bindingBytes)},delivery_policy:'unreviewed_draft',human_visual_acceptance:false};
 const zip=forceZip64Stored([{name:'handoff.json',bytes:json(manifest)},{name:'decomposition/ui.draft.zip',bytes:nested},{name:'component.ui-bundle.json',bytes:bundleBytes},{name:'appearance-binding.json',bytes:bindingBytes}]);
 const dir=resolve(out,caseName);await mkdir(dir);await writeFile(resolve(dir,'ui.component-handoff.draft.zip'),zip);
 const reference=members.find(m=>m.name==='preview.png').bytes;await writeFile(resolve(dir,'reference.png'),reference);
 const names=kind==='Tabs'?node.props.tabs.map(x=>x.id):['Select','RadioGroup'].includes(kind)?node.props.options.map(x=>x.id):kind==='List'?node.props.items.map(x=>x.id):kind==='Button'?['default','hover','pressed']:['off','on'];
 const slots=kind==='Tabs'?names.flatMap(id=>['background/'+id,'icon/'+id]):kind==='List'?['background',...names.map(id=>'row/'+id)]:kind==='RadioGroup'?names.flatMap(id=>['option/'+id,'indicator/'+id]):({Button:['background'],Switch:['track','thumb'],Select:['background','indicator','popup'],CheckBox:['box','mark']})[kind];
 const evidence={kind:'ui_state_evidence_v1',handoffSha256:hash(zip),reference:{path:'reference.png',sha256:hash(reference)},components:{[node.id]:{states:Object.fromEntries(names.map(n=>[n,{basis:'user-confirmed',region:[node.layout.x,node.layout.y,node.layout.width,node.layout.height],note:'Synthetic regression specification: explicit state assets and geometry; reference is a test canvas, not an artist-approved scene.'}])),relations:Object.fromEntries(slots.map(s=>[s,{mode:kind==='Tabs'||s.startsWith('row/')?'distinct':'shared',note:'Local fixture explicitly specifies this resource relationship; mark visibility and thumb movement are separate from shared pixels.'}]))}}};
 await writeFile(resolve(dir,'evidence.json'),json(evidence));
}
