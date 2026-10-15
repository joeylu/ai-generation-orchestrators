import assert from 'node:assert/strict';
import { hash } from '../../src/skins/package.mjs';
import { decodePng } from '../../src/skins/png.mjs';
export async function runSkinChecks(h, packet) {
  const expectedCount=JSON.parse(Buffer.from(packet.manifest,'base64')).assets.length;
  const results=[];
  const check=async(id,fn)=>{try{await fn();results.push({id,status:'passed'});}catch(e){results.push({id,status:'failed',message:e.message});}};
  await check('S01.png-source',async()=>{
    assert.deepEqual(await h.page.evaluate(()=>({format:harness.skin.format,kind:harness.skin.sourceKind,count:harness.skin.textures.size})),{format:'png-pack',kind:'fixture',count:expectedCount});
  });
  await check('S02.asymmetric-slice',async()=>{
    const actual=await h.page.evaluate(()=>{
      const v=harness.skin.view('skin.button.primary.normal',240,48);
      const r=[v.leftWidth,v.topHeight,v.rightWidth,v.bottomHeight];v.destroy();return r;
    });
    assert.deepEqual(actual,[3,2,5,4]);
  });
  await check('S03.failure-isolation',async()=>{
    const damaged=structuredClone(packet), pack=JSON.parse(Buffer.from(packet.manifest,'base64'));
    damaged.resources[pack.assets[2].file]=Buffer.from('not PNG').toString('base64');
    assert.equal(await h.page.evaluate(async ({p,count})=>{const before=document.fonts.size;try{await harness.loadPack(p);return false;}catch(e){return e.code==='skin.digest'&&document.fonts.size===before&&harness.skin.textures.size===count;}},{p:damaged,count:expectedCount}),true);
  });
  await check('S04.binding-and-manifest',async()=>{
    for(const what of ['manifest','bindings']){
      const bad=structuredClone(packet);
      if(what==='manifest')bad.manifestSha256='0'.repeat(64);else bad.bindings.templateSha256='0'.repeat(64);
      assert.equal(await h.page.evaluate(async p=>{try{await harness.loadPack(p);return false;}catch(e){return ['skin.digest','skin.binding'].includes(e.code);}},bad),true);
    }
  });
  await check('S05.font-and-dispose',async()=>{
    assert.equal(await h.page.evaluate(async ({p,count})=>{
      const before=document.fonts.size, s=await harness.loadPack(p);
      const ok=document.fonts.size>before&&s.profile.fontFamily!==harness.skin.profile.fontFamily;
      s.dispose();s.dispose();return ok&&document.fonts.size===before&&s.textures.size===0&&harness.skin.textures.size===count;
    },{p:packet,count:expectedCount}),true);
  });
  await check('S06.imported-source-path',async()=>{
    const imported=structuredClone(packet), pack=JSON.parse(Buffer.from(packet.manifest,'base64'));
    pack.sourceKind='imported'; const bytes=Buffer.from(JSON.stringify(pack));
    imported.manifest=bytes.toString('base64');imported.manifestSha256=hash(bytes);
    // Test-double provenance switch only; never publish this synthetic variant.
    assert.equal(await h.page.evaluate(async p=>{const s=await harness.loadPack(p),r=harness.runtimeForSkin(s);const button=r.create({id:'imported-button',recipeRef:harness.cases.find(c=>c.type==='Button').recipeRef,props:{label:'PNG'},size:{width:240,height:48}});const ok=button.recipe.type==='Button'&&s.sourceKind==='imported'&&s.visualAcceptance==='unreviewed';r.dispose();s.dispose();return ok;},imported),true);
  });
  await check('S07.minimum-atomic',async()=>{
    const other=structuredClone(packet),pack=JSON.parse(Buffer.from(packet.manifest,'base64'));
    for(const a of pack.assets.filter(a=>a.assetId.startsWith('button.primary.')))a.minSize.width=210;
    const bytes=Buffer.from(JSON.stringify(pack));other.manifest=bytes.toString('base64');other.manifestSha256=hash(bytes);
    assert.equal(await h.page.evaluate(async p=>{const s=await harness.loadPack(p),r=harness.runtimeForSkin(s);try{const button=r.create({id:'minimum-button',recipeRef:harness.cases.find(c=>c.type==='Button').recipeRef,props:{label:'PNG'},size:{width:240,height:48}});try{button.resize(180,48);return false;}catch(e){return e.code==='skin.minimum'&&button.size.width===240&&button.adapter.view.defaultView.width===240;}}finally{r.dispose();s.dispose();}},other),true);
  });
  await check('S08.independent-png-decoder',async()=>{
    for(const asset of JSON.parse(Buffer.from(packet.manifest,'base64')).assets){
      const b64=packet.resources[asset.file], image=decodePng(Buffer.from(b64,'base64'));
      const points=[[0,0],[Math.floor(image.width/2),Math.floor(image.height/2)],[image.width-1,image.height-1]];
      const actual=await h.page.evaluate(async({b64,points})=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'}));try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);return points.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);}finally{bitmap.close();}},{b64,points});
      points.forEach(([x,y],i)=>assert.deepEqual(actual[i],[...image.pixels.subarray((y*image.width+x)*4,(y*image.width+x)*4+4)],asset.assetId));
    }
  });
  return results;
}
