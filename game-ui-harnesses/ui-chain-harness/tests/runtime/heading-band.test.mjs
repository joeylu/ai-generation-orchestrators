import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {extendSkinMaterials} from '../../src/skins/materials.mjs';
import {verifySkinPackage,hash} from '../../src/skins/package.mjs';
import {encodePng,decodePng} from '../../src/skins/png.mjs';
import {startHarness} from './harness.mjs';
test('explicit reference headings preserve full vertical artwork, end ornament proportions, frozen source and old cover rendering',async()=>{
 const f=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-chain-heading-band-'))),image={width:240,height:96,pixels:Buffer.alloc(240*96*4)};
 const paint=(x,y,w,h,rgb)=>{for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)image.pixels.set([...rgb,255],(py*240+px)*4);};
 paint(2,2,236,92,[220,170,30]);paint(6,6,228,84,[55,80,115]);paint(16,24,208,48,[95,130,180]);paint(20,28,200,40,[20,40,70]);
 paint(17,21,3,5,[220,170,30]);
 paint(26,43,6,10,[100,180,190]);paint(208,43,6,10,[100,180,190]);
 const bytes=encodePng(image);await writeFile(join(f.directory,'nested.png'),bytes);
 f.config.materials=[{assetId:'material.heading',file:'nested.png',sha256:hash(bytes),crop:[0,0,240,96]}];
 f.config.surfaceStyles={title:{baseRole:'skin.surface.bar',baseMode:'replace',insets:{left:18,right:18,top:4,bottom:4},textColor:'#FFFFFF',layers:[{assetId:'material.heading',mode:'cover'}]}};
 await writeFile(f.configPath,JSON.stringify(f.config));
 const r=await extendSkinMaterials({...f,output:join(f.directory,'extended')}),v=await verifySkinPackage(r.packageDirectory),manifest=await readFile(join(r.packageDirectory,'skin-pack.json'));
 const packet={manifest:manifest.toString('base64'),manifestSha256:v.manifestSha256,bindings:v.pack.bindings,resources:Object.fromEntries([...v.resources].map(([k,b])=>[k,b.toString('base64')]))};
 const h=await startHarness({skinPack:packet});
 try{
  const state=await h.page.evaluate(()=>{
   harness.clear();window.headingNodes=[];
   for(const [index,[width,height]]of [[500,64],[500,48],[220,64]].entries()){
    const n=harness.runtime.create({id:'reference-heading-'+index,recipeRef:'text@1.0.0',surfaceStyle:'title',surfaceBand:'reference-v1',surfaceTextInsets:{left:80,right:64,top:4,bottom:4},props:{text:'A',textStyleRef:'body',overflow:'error'},size:{width,height}});
    harness.runtime.mount(n);n.root.position.set(30,30+index*110);headingNodes.push(n);
   }
   const old=harness.runtime.create({id:'old-heading',recipeRef:'text@1.0.0',surfaceStyle:'title',props:{text:'A',textStyleRef:'body',overflow:'error'},size:{width:500,height:64}});
   harness.runtime.mount(old);old.root.position.set(600,30);window.oldHeading=old;harness.app.render();
   return {bands:headingNodes.map(n=>({snapshot:n.snapshot(),derived:n.adapter.surface.runtimeHeadingBands,parts:n.adapter.surface.layers[0].heading.parts.map(s=>({width:s.width,height:s.height,scale:{x:s.scale.x,y:s.scale.y}})),text:{x:n.adapter.text.x,y:n.adapter.text.y,width:n.adapter.text.width,height:n.adapter.text.height}})),old:{snapshot:old.snapshot(),height:old.adapter.surface.layers[0].item.height,width:old.adapter.surface.layers[0].item.width,derived:old.adapter.surface.runtimeHeadingBands??null}};
  });
  for(const band of state.bands){
   assert.equal(band.snapshot.surfaceBand,'reference-v1');assert.equal(band.derived[0].method,'nested-opaque-frame-v1');assert.deepEqual(band.derived[0].cornerCuts.topLeft,{width:5,height:3});
   assert.equal(band.parts.length,3);assert(band.parts.every(p=>p.height===band.snapshot.size.height));
   for(const cap of[band.parts[0],band.parts[2]])assert(Math.abs(cap.scale.x-cap.scale.y)<1e-6);
   assert(band.text.x>=80&&band.text.x+band.text.width<=band.snapshot.size.width-64);
   assert(band.text.y>=4&&band.text.y+band.text.height<=band.snapshot.size.height-4);
  }
  assert.equal(state.old.snapshot.surfaceBand,undefined);assert.equal(state.old.derived,null);assert(Math.abs(state.old.width-500)<1e-6);assert(Math.abs(state.old.height-200)<1e-6);
  const png=decodePng(await h.page.screenshot()),gold=(x,y)=>{const p=(y*png.width+x)*4;return png.pixels[p]>180&&png.pixels[p+1]>130&&png.pixels[p+2]<65;};
  for(const [i,[w,height]]of [[500,64],[500,48],[220,64]].entries())for(let y=30+i*110;y<30+i*110+height;y++)for(let x=30;x<30+w;x++)assert.equal(gold(x,y),false,'Outer gold frame or overlapping corner leaked into new heading.');
  assert(gold(606,62)||gold(607,62)||gold(608,62),'Historic cover rendering should still expose the original outer frame.');
  const lifecycle=await h.page.evaluate(()=>{
   const n=headingNodes[0],before=n.snapshot(),heading=n.adapter.surface.layers[0].heading,derived=heading.derived,source=derived[0].source;
   let rejected=false;try{n.resize(100,64);}catch(e){rejected=['skin.heading-band','skin.surface-style'].includes(e.code);}
   const unchanged=JSON.stringify(n.snapshot())===JSON.stringify(before);n.dispose();
   return {rejected,unchanged,derivedDestroyed:derived.every(t=>t.destroyed),sourceDestroyed:source.destroyed,sourceStillOwned:harness.skin.runtimeHeadingBandTextures.get('material.heading').source===source,distinctSource:harness.skin.textures.get('material.heading').source!==source,bandMipmaps:source.autoGenerateMipmaps,oldMipmaps:harness.skin.textures.get('material.heading').source.autoGenerateMipmaps,distinctBitmap:source.resource!==harness.skin.textures.get('material.heading').source.resource};
  });
  assert.deepEqual(lifecycle,{rejected:true,unchanged:true,derivedDestroyed:true,sourceDestroyed:false,sourceStillOwned:true,distinctSource:true,bandMipmaps:false,oldMipmaps:true,distinctBitmap:true});
  const released=await h.page.evaluate(()=>{
   const bandSource=harness.skin.runtimeHeadingBandTextures.get('material.heading').source,oldSource=harness.skin.textures.get('material.heading').source,bandBitmap=bandSource.resource,oldBitmap=oldSource.resource;
   const before={band:bandBitmap.width,old:oldBitmap.width};harness.runtime.dispose();harness.skin.dispose();harness.skin.dispose();
   return {before,bandDestroyed:bandSource.destroyed,oldDestroyed:oldSource.destroyed,bandWidth:bandBitmap.width,oldWidth:oldBitmap.width,cacheCount:harness.skin.runtimeHeadingBandTextures.size};
  });
  assert.deepEqual(released,{before:{band:240,old:240},bandDestroyed:true,oldDestroyed:true,bandWidth:0,oldWidth:0,cacheCount:0});
  assert.deepEqual(h.errors,[]);assert.equal(hash(await readFile(join(f.directory,'nested.png'))),hash(bytes));assert.deepEqual(await readFile(join(r.packageDirectory,'skin-pack.json')),manifest);
 }finally{await h.close();}
});

test('document heading font sizes work with a legacy props contract, retain snapshot scope and never leak into skin or props',async()=>{
 const f=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-chain-heading-font-'))),v=await verifySkinPackage(f.packageDirectory);
 const manifest=await readFile(join(f.packageDirectory,'skin-pack.json')),packet={manifest:manifest.toString('base64'),manifestSha256:v.manifestSha256,bindings:v.pack.bindings,resources:Object.fromEntries([...v.resources].map(([k,b])=>[k,b.toString('base64')]))};
 const h=await startHarness({skinPack:packet});
 try{
  const result=await h.page.evaluate(()=>{
   harness.clear();const runtime=harness.runtime;
   // In-memory legacy contract double. The saved package and source contract
   // are never rewritten or upgraded to make presentation props acceptable.
   const schema=runtime.registry.recipes.find(r=>r.type==='Text').propsSchema;
   const authoredFontSchema=schema.properties.fontSize;
   delete schema.properties.fontSize;
   const before={profile:JSON.stringify(harness.skin.profile),schema:JSON.stringify(schema)},props={text:'A',textStyleRef:'body',overflow:'error'},base={recipeRef:'text@1.0.0',surfaceStyle:'title',surfaceBand:'reference-v1',surfaceTextInsets:{left:18,right:18,top:4,bottom:4},props,size:{width:500,height:180}};
   let propsRejected=false;try{runtime.create({...base,id:'legacy-font-prop',props:{...props,fontSize:28}});}catch(e){propsRejected=e.issues?.some(i=>i.path.endsWith('/fontSize'));}
   const rows=[];
   for(const fontSize of [8,11,28,96]){
    const node=runtime.create({...base,id:'heading-font-'+fontSize,surfaceFontSize:fontSize});
    const snap=node.snapshot(),copy=runtime.create({...snap,id:node.id+'-copy'});
    rows.push({fontSize,drawn:node.adapter.text.style.fontSize,copied:copy.adapter.text.style.fontSize,snapshotSize:snap.surfaceFontSize,hasProp:Object.hasOwn(snap.props,'fontSize')});
   }
   const legacy=runtime.create({...base,id:'legacy-font-absent',surfaceBand:undefined,surfaceTextInsets:undefined}),legacyBand=runtime.create({...base,id:'band-font-absent'});
   let overflowRejected=false;try{runtime.create({...base,id:'large-heading-overflow',surfaceFontSize:96,size:{width:500,height:48}});}catch(e){overflowRejected=e.code==='text.overflow';}
   const valid=runtime.handles.get('heading-font-28'),snapshot=JSON.stringify(valid.snapshot());let resizeRejected=false;try{valid.resize(500,24);}catch(e){resizeRejected=e.code==='text.overflow';}
   const invalid=[];
   for(const [index,patch]of [{surfaceFontSize:7},{surfaceFontSize:97},{surfaceFontSize:28.5},{surfaceFontSize:'28'},{surfaceFontSize:28,surfaceBand:undefined},{surfaceFontSize:28,surfaceStyle:undefined}].entries()){
    try{runtime.create({...base,...patch,id:'invalid-heading-font-'+index});invalid.push(false);}catch(e){invalid.push(e.code==='skin.surface-style');}
   }
   const contractUnchanged=JSON.stringify(schema)===before.schema;
   // A separately supported current contract may expose an explicit editor
   // override. That authored value must beat the presentation default.
   schema.properties.fontSize=authoredFontSchema;
   const authored=runtime.create({...base,id:'authored-heading-font',surfaceFontSize:28,props:{...props,fontSize:24}}),authorSnapshot=authored.snapshot();
   authored.resize(520,180);const authorCopy=runtime.create({...authorSnapshot,id:'authored-heading-font-copy'});
   const authorOverride={drawn:authored.adapter.text.style.fontSize,copied:authorCopy.adapter.text.style.fontSize,propsSize:authorSnapshot.props.fontSize,surfaceSize:authorSnapshot.surfaceFontSize};
   return {propsRejected,rows,legacyFont:legacy.adapter.text.style.fontSize,legacyBandFont:legacyBand.adapter.text.style.fontSize,baseFont:harness.skin.profile.fontSize,legacySnapshotHasField:Object.hasOwn(legacy.snapshot(),'surfaceFontSize'),overflowRejected,resizeRejected,resizeUnchanged:JSON.stringify(valid.snapshot())===snapshot,invalid,profileUnchanged:JSON.stringify(harness.skin.profile)===before.profile,contractUnchanged,authorOverride};
  });
  assert(result.propsRejected);assert.equal(result.legacyFont,result.baseFont);assert.equal(result.legacyBandFont,result.baseFont);assert.equal(result.legacySnapshotHasField,false);
  for(const row of result.rows)assert.deepEqual(row,{fontSize:row.fontSize,drawn:row.fontSize,copied:row.fontSize,snapshotSize:row.fontSize,hasProp:false});
  assert(result.overflowRejected&&result.resizeRejected&&result.resizeUnchanged);assert(result.invalid.every(Boolean));assert(result.profileUnchanged&&result.contractUnchanged);assert.deepEqual(h.errors,[]);
  assert.deepEqual(result.authorOverride,{drawn:24,copied:24,propsSize:24,surfaceSize:28});
  assert.deepEqual(await readFile(join(f.packageDirectory,'skin-pack.json')),manifest);
 }finally{await h.close();}
});
