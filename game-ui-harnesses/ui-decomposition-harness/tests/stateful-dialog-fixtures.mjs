// Deterministic local fixture, public importer and real alpha; never production art.
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateSync, inflateSync} from 'node:zlib';
const [root,out]=process.argv.slice(2,4).map(p=>resolve(p));
const withImages=process.argv.includes('--with-images');
const mod=p=>import(pathToFileURL(resolve(root,p)));
const {fixtureLayeredZip,forceZip64Stored,fixtureRgbaPng}=await mod('tests/helpers/decomposition-fixture.ts');
const {createBundle}=await mod('src/bundle.ts');
const {importDecompositionZip}=await mod('src/decomposition-import.ts');
const {appearanceDocumentSha256}=await mod('src/appearance-binding.ts');
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical)}]`:`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`;
const json=v=>Buffer.from(canonical(v)+'\n');
const crc=b=>{let v=0xffffffff;for(const c of b){v^=c;for(let i=0;i<8;i++)v=(v>>>1)^(v&1?0xedb88320:0);}return (v^0xffffffff)>>>0;};
const chunk=(t,b)=>{const x=Buffer.alloc(b.length+12);x.writeUInt32BE(b.length);x.write(t,4);b.copy(x,8);x.writeUInt32BE(crc(x.subarray(4,-4)),x.length-4);return x;};
function border(png){
 const b=Buffer.from(png),w=b.readUInt32BE(16),h=b.readUInt32BE(20),chunks=[];
 for(let i=8;i<b.length;){const n=b.readUInt32BE(i);if(b.toString('ascii',i+4,i+8)==='IDAT')chunks.push(b.subarray(i+8,i+8+n));i+=n+12;}
 const raw=inflateSync(Buffer.concat(chunks));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x===0||y===0||x===w-1||y===h-1)raw.fill(0,y*(w*4+1)+1+x*4,y*(w*4+1)+5+x*4);
 return Buffer.concat([b.subarray(0,33),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
await mkdir(out,{recursive:false});
for(const mode of ['raster','native','single-frame']){
 const rasterOverlay=mode==='raster', singleFrame=mode==='single-frame';
 const dir=resolve(out,rasterOverlay?'Dialog':singleFrame?'Dialog-single-frame':'Dialog-native-overlay');await mkdir(dir);
 const style={backgroundColor:'#FFFFFF',borderColor:'#303030',borderWidth:0,cornerRadius:0,textColor:'#102030',fontFamily:'sans-serif',fontSize:16,fontWeight:'normal',opacity:1};
 const layout=(x,y,width,height)=>({x,y,width,height});
 const button=(id,x,y,label)=>({id,type:'Button',layout:layout(x,y,80,30),props:{label,enabled:true,style},children:[]});
 const dialog={id:'dialog',type:'Dialog',layout:layout(80,100,360,240),props:{open:false,modal:true,title:'Reward',style},children:[button('close',265,8,'X'),button('later',25,185,'Later'),button('claim',240,185,'Claim')]};
 if(singleFrame)dialog.props.backdrop={color:'#000000',opacity:0.6};
 const document={schemaVersion:'0.2',id:'stateful-dialog-fixture',canvas:{width:540,height:400},root:{id:'root',type:'Container',layout:layout(0,0,540,400),props:{style},children:[button('underlay',20,25,'Mail'),dialog]}};
 if(withImages)for(const n of [document.root.children[0],...dialog.children])n.children.push({id:n.id+'-icon',type:'Image',layout:layout(6,6,20,18),props:{source:'child-icon.png',fit:'contain',drawBackground:false,style}});
 const layer=(id,x,y,w,h,color)=>({id,role:id==='scene'?'background':'important_component',left:x,top:y,width:w,height:h,color});
 const specs=[layer('scene',0,0,540,400,[170,190,180,255]),layer('dialog-background',80,singleFrame?140:100,360,singleFrame?200:240,[225,225,215,255]),layer('dialog-body',90,158,340,172,[225,215,195,255]),layer('dialog-header',90,110,340,45,[155,180,150,255]),layer('underlay-art',20,25,80,30,[70,155,180,255]),...dialog.children.map((n,i)=>layer(n.id+'-art',80+n.layout.x,100+n.layout.y,80,30,[80+45*i,125,155,255]))];
 if(rasterOverlay)specs.push(layer('dialog-overlay',0,0,540,400,[20,30,45,120]));
 const f=await fixtureLayeredZip([540,400],specs),scene=structuredClone(f.scene),delivery=structuredClone(f.delivery),members=f.members.map(m=>({name:m.name,bytes:Buffer.from(m.bytes)}));
 for(const l of scene.tree.flatMap(g=>g.children)){const m=members.find(m=>m.name===l.png);if(l.id!=='scene'&&l.id!=='dialog-overlay')m.bytes=border(m.bytes);l.sha256=hash(m.bytes);}
 const sb=json(scene);members.find(m=>m.name==='scene.json').bytes=sb;delivery.scene_sha256=hash(sb);delete delivery.digest;delivery.digest=hash(Buffer.from(canonical(delivery)));members.find(m=>m.name==='delivery.json').bytes=json(delivery);
 const nested=forceZip64Stored(members),imported=await importDecompositionZip(nested),area=(x,y,w,h)=>({coordinateSpace:'target-component-local',...layout(x,y,w,h)});
 const binding={kind:'ui-appearance-binding',version:'0.2',documentSha256:await appearanceDocumentSha256(document),deliveryDigest:imported.deliveryDigest,sceneSha256:imported.sceneSha256,archiveSha256:imported.archiveSha256,registration:{sourceCanvas:document.canvas,targetCanvas:document.canvas,transform:{scale:1,offset:{x:0,y:0}}},bindings:[{componentId:'dialog',componentType:'Dialog',parts:[...['background','header','body'].map(role=>({role,layerId:'dialog-'+role})),...(rasterOverlay?[{role:'overlay',layerId:'dialog-overlay'}]:[])],states:{dialog:{titleLayout:area(20,10,200,35)}}},...[document.root.children[0],...dialog.children].map(n=>({componentId:n.id,componentType:'Button',parts:[{role:'background',layerId:n.id+'-art'}],states:{button:{labelLayout:withImages?area(30,3,46,24):area(4,3,72,24)}}}))]};
 if(singleFrame)binding.bindings[0].parts=binding.bindings[0].parts.filter(p=>p.role!=='body');
 const target=await createBundle(document,withImages?[{path:'child-icon.png',mime:'image/png',bytes:border(fixtureRgbaPng(20,18,[245,235,80,255]))}]:[],{kind:'programmatic-fixture',description:'Local Dialog acceptance fixture, including child action buttons and a background modal probe.'}),bb=json(target),ab=json(binding);
 const manifest={kind:'ai_ui_component_handoff_v1',status:'contracts_packaged_unreviewed_draft',decomposition:{path:'decomposition/ui.draft.zip',sha256:hash(nested)},component_bundle:{path:'component.ui-bundle.json',sha256:hash(bb)},appearance_binding:{path:'appearance-binding.json',sha256:hash(ab)},delivery_policy:'unreviewed_draft',human_visual_acceptance:false};
 const zip=forceZip64Stored([{name:'handoff.json',bytes:json(manifest)},{name:'decomposition/ui.draft.zip',bytes:nested},{name:'component.ui-bundle.json',bytes:bb},{name:'appearance-binding.json',bytes:ab}]);
 await writeFile(resolve(dir,'ui.component-handoff.draft.zip'),zip);
 const reference=members.find(m=>m.name==='preview.png').bytes;await writeFile(resolve(dir,'reference.png'),reference);
 const proof={basis:'contract-derived',region:[0,0,540,400],note:'Explicit local procedural regression fixture; not reference reconstruction or human acceptance.'};
 const evidence={kind:'ui_state_evidence_v1',handoffSha256:hash(zip),reference:{path:'reference.png',sha256:hash(reference)},components:Object.fromEntries(binding.bindings.map(b=>[b.componentId,{states:Object.fromEntries((b.componentType==='Dialog'?['open','closed','reopened']:['default','hover','pressed']).map(n=>[n,proof])),relations:Object.fromEntries(b.parts.map(p=>[p.role,{mode:'shared',note:'This fixture explicitly shares each role texture; visibility changes independently.'}]))}]))};
 await writeFile(resolve(dir,'evidence.json'),json(evidence));
}
