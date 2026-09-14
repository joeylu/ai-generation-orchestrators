import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
const [root,out]=process.argv.slice(2,4).map(p=>resolve(p));const v2=process.argv[4]==='v2';await mkdir(out);
const mod=p=>import(pathToFileURL(resolve(root,p)));
const {fixtureLayeredZip,forceZip64Stored}=await mod('tests/helpers/decomposition-fixture.ts');
const {createBundle}=await mod('src/bundle.ts');const {importDecompositionZip}=await mod('src/decomposition-import.ts');
const {appearanceDocumentSha256}=await mod('src/appearance-binding.ts');
const hash=b=>createHash('sha256').update(b).digest('hex'),json=v=>Buffer.from(JSON.stringify(v));
function png(w,h,color){
 const rows=Buffer.alloc(h*(w*4+1));for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)rows.set([...color,255],y*(w*4+1)+1+x*4);
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const b of body){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}const a=Buffer.alloc(4),z=Buffer.alloc(4);a.writeUInt32BE(data.length);z.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([a,body,z]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
for(const height of [180,240]){
 const dir=resolve(out,height===180?'scroll':'zero');await mkdir(dir);
 const style={backgroundColor:'#FFFFFF',borderColor:'#000000',borderWidth:0,cornerRadius:0,textColor:'#182C55',fontFamily:'Arial',fontSize:14,fontWeight:'normal',opacity:1};
 const area=(coordinateSpace,x,y,width,height)=>({coordinateSpace,x,y,width,height});
 const children=[];for(let i=0;i<3;i++){
  children.push({id:`icon-${i}`,type:'Image',layout:{x:8,y:i*80+8,width:32,height:32},props:{source:'icon.png',fit:'contain',drawBackground:false,style}});
  children.push({id:`text-${i}`,type:'Text',layout:{x:52,y:i*80+38,width:160,height:38},props:{text:'Details about\nthis item.',wrap:'word',overflow:'clip',lineHeight:17,drawBackground:false,style}});
 }
 const list={id:'list',type:'List',layout:{x:0,y:0,width:220,height:240},props:{selectedId:'second',items:[{id:'first',label:'FIRST'},{id:'second',label:'SECOND'},{id:'third',label:'THIRD'}],itemTemplate:'text-row',itemHeight:80,rowGap:6,enabled:true,style},children};
 const document={schemaVersion:'0.2',id:'list-children-fixture',canvas:{width:400,height:400},root:{id:'root',type:'Container',layout:{x:0,y:0,width:400,height:400},props:{style},children:[
  {id:'scroll',type:'ScrollView',layout:{x:20,y:30,width:260,height},props:{scrollX:0,scrollY:0,contentWidth:240,contentHeight:240,scrollbarVisibility:'always',style},children:[list]},
  {id:'selected-name',type:'Text',layout:{x:20,y:300,width:360,height:38},props:{text:'Authored fallback',wrap:'none',overflow:'clip',lineHeight:20,drawBackground:false,style}}
 ]}};
 const specs=[['viewport',20,30,260,height,[210,220,230]],['track',262,40,14,height-20,[60,90,110]],['thumb',263,50,12,30,[100,180,190]],['background',20,30,220,240,[220,220,210]],['row',20,30,220,74,[240,235,220]],['selected',20,110,220,74,[160,215,170]]];
 const fixture=await fixtureLayeredZip([400,400],[{id:'scene',role:'background',left:0,top:0,width:400,height:400},...specs.map(([id,left,top,width,height,color])=>({id,role:'important_component',left,top,width,height,bytes:png(width,height,color)}))]);
 const imported=await importDecompositionZip(fixture.zip),target=await createBundle(document,[{path:'icon.png',mime:'image/png',bytes:png(32,32,[170,40,90])}],{kind:'programmatic-fixture',description:'Offline List child pixels and scroll clipping; no reference artwork or media provider.'});
 const binding={kind:'ui-appearance-binding',version:'0.2',documentSha256:await appearanceDocumentSha256(document),deliveryDigest:imported.deliveryDigest,sceneSha256:imported.sceneSha256,archiveSha256:imported.archiveSha256,
  registration:{sourceCanvas:document.canvas,targetCanvas:document.canvas,transform:{scale:1,offset:{x:0,y:0}}},bindings:[
   {componentId:'scroll',componentType:'ScrollView',parts:[{role:'viewport',layerId:'viewport'},{role:'scrollbar-track',layerId:'track'},{role:'scrollbar-thumb',layerId:'thumb'}],states:{scrollView:{thumbPositions:{coordinateSpace:'target-component-local',anchor:'top-left',min:{x:243,y:20},max:{x:243,y:height-50}},scrollbarInsets:{version:'1.0',top:10,bottom:10}}}},
   {componentId:'list',componentType:'List',parts:[{role:'background',layerId:'background'},{role:'row',layerId:'row',itemId:'first'},{role:'selected-row',layerId:'selected',itemId:'second'}],states:{list:{labelLayout:area('target-item-local',52,2,160,24),hitArea:area('target-item-local',0,0,220,74)}}}
  ]};
 const bundleBytes=json(target),bindingBytes=json(binding),manifest={kind:'ai_ui_component_handoff_v1',status:'contracts_packaged_unreviewed_draft',delivery_policy:'unreviewed_draft',human_visual_acceptance:false,
  decomposition:{path:'decomposition/ui.draft.zip',sha256:hash(fixture.zip)},component_bundle:{path:'component.ui-bundle.json',sha256:hash(bundleBytes)},appearance_binding:{path:'appearance-binding.json',sha256:hash(bindingBytes)}};
 const entries=[{name:'decomposition/ui.draft.zip',bytes:fixture.zip},{name:'component.ui-bundle.json',bytes:bundleBytes},{name:'appearance-binding.json',bytes:bindingBytes}];
 if(v2){
  const state=json({kind:'ui-reference-state',schemaVersion:'1.0',components:[{componentId:'list',componentType:'List',fields:{selectedId:{status:'observed',value:'second',evidence:'Explicit procedural fixture state; not reference artwork.'}}},{componentId:'scroll',componentType:'ScrollView',fields:{scrollX:{status:'unknown',reason:'Synthetic reference image does not establish scroll coordinates.'},scrollY:{status:'unknown',reason:'Synthetic reference image does not establish scroll coordinates.'}}}]});
  const allNodes=[];const visit=n=>{allNodes.push(n);for(const c of n.children??[])visit(c);};visit(document.root);
  const scope=json({kind:'ui-acceptance-scope',schemaVersion:'1.0',referenceState:'reference/reference-state.json',human_visual_acceptance:false,derivedTestStates:[],components:allNodes.map(n=>({componentId:n.id,mode:'compare',reason:'Procedural fixture'}))});
  manifest.kind='ai_ui_component_handoff_v2';manifest.schemaVersion='2.0';
  manifest.reference={original:{path:'reference/original.png',sha256:hash(imported.preview.bytes),width:400,height:400},state:{path:'reference/reference-state.json',sha256:hash(state)},scope:{path:'acceptance-scope.json',sha256:hash(scope)},mapping:{coordinateSpace:'raw-image-pixel-edges-to-runtime-canvas',sourceSize:[400,400],targetSize:[400,400],crop:[0,0,400,400],rotationDegrees:0,flipX:false,flipY:false,scale:[1,1],offset:[0,0]},derivatives:[]};
  entries.push({name:'reference/original.png',bytes:imported.preview.bytes},{name:'reference/reference-state.json',bytes:state},{name:'acceptance-scope.json',bytes:scope});
 }
 const zip=forceZip64Stored([{name:'handoff.json',bytes:json(manifest)},...entries]);
 await writeFile(resolve(dir,'ui.component-handoff.draft.zip'),zip);await writeFile(resolve(dir,'reference.png'),imported.preview.bytes);
 await writeFile(resolve(dir,'value-text-bindings.json'),json({version:'1.1',bindings:[{sourceId:'list',targetId:'selected-name',parts:['Selected: ',{field:'selectedId',items:[{itemId:'first',text:'First'},{itemId:'second',text:'Second'},{itemId:'third',text:'Third'}],emptyText:'(none)'}]}]}));
 const policy=(names,slots,distinct)=>({states:Object.fromEntries(names.map(n=>[n,{basis:'contract-derived',region:[20,30,260,height],note:'Explicit local synthetic fixture; not observed reference art.'}])),relations:Object.fromEntries(slots.map(s=>[s,{mode:distinct&&s.startsWith('row/')?'distinct':'shared',note:'Explicit fixture resource sharing / selected state colors.'}]))});
 await writeFile(resolve(dir,'evidence.json'),json({kind:'ui_state_evidence_v1',handoffSha256:hash(zip),reference:{path:'reference.png',sha256:hash(imported.preview.bytes)},components:{
  scroll:policy(['top','middle','bottom'],['viewport','track','thumb'],false),list:policy(['first','second','third'],['background','row/first','row/second','row/third'],true)
 }}));
}
