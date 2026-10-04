import { appearanceApplicationFixture } from './appearance-application-fixture.ts';
import { fixtureRgbaPng } from './decomposition-fixture.ts';
import { referenceSha256, zip } from '../../src/reference-persistence.ts';

/** Synthetic offline contract fixture, never evidence of model recognition. */
export async function assetsPackageFixture() {
  const value = await appearanceApplicationFixture();
  const entries = new Map(value.fixture.members.map(row=>[row.name,new Uint8Array(row.bytes)]));
  entries.set('reference/original.png',fixtureRgbaPng(500,400,[220,180,130,255]));
  const files = [];
  for (const [path,bytes] of [...entries].sort(([a],[b])=>a.localeCompare(b))) {
    const layer = value.imported.layers.find(row=>row.path===path);
    files.push({path,sha256:await referenceSha256(bytes),bytes:bytes.length,mediaType:path.endsWith('.json')?'application/json':'image/png',
      ...(path.endsWith('.png')?{width:layer?.width??500,height:layer?.height??400}:{})});
  }
  const manifest:any = {kind:'ai_ui_assets_package',schemaVersion:'2.0',files,scene:'scene.json',delivery:'delivery.json',preview:'preview.png',
    reference:{original:'reference/original.png',mapping:{coordinateSpace:'raw-image-pixel-edges-to-runtime-canvas',sourceSize:[500,400],targetSize:[500,400],crop:[0,0,500,400],rotationDegrees:0,flipX:false,flipY:false,scale:[1,1],offset:[0,0]}},
    scope:{type:'complete',description:'Synthetic materials; explicit control fixture, no model recognition.',base:null},previewPurpose:'decomposition-composite',human_visual_acceptance:false,
    assets:value.imported.layers.map(layer=>({layerId:layer.id,assetId:layer.asset,path:layer.path,visibleBounds:[0,0,layer.width,layer.height],sourceRegions:null,bakedContent:null,relation:{action:'included',targetLayerId:null}})),
    stateRelations:[],missingParts:[],lineage:[]};
  const rebuild = () => { entries.set('manifest.json',new TextEncoder().encode(JSON.stringify(manifest))); return zip(entries); };
  const bytes = rebuild(), binding = {...value.binding,archiveSha256:await referenceSha256(bytes)};
  return {...value,manifest,entries,rebuild,bytes,binding};
}
