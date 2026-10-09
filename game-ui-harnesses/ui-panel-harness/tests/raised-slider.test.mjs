import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {core,nodesOf} from './helpers.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {sliderClarityStudy} from '../examples/slider-clarity-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {compilePanel} from '../src/compiler.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {raisedSliderThumb,raisedSliderPalette} from '../src/raised-slider.mjs';
import {minimalControlSkin} from '../src/minimal-skin.mjs';
import {assertSliderClarityStudy} from '../scripts/lib/slider-clarity-study.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool);
async function source(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  const raw=await createPanelBundle(spec,catalog,core,{volume:67,music:32,muted:true},await workbenchAssetInputs(spec,pool));
  const input=groupedAudioStudy(raw);input.catalog.themes[0].iconStyle='plain-v1';
  return createPanelBundle(input.spec,input.catalog,core,raw.state,panelBundleAssetInputs(raw,core));
}
function decoded(bytes){
  const buffer=Buffer.from(bytes);assert.equal(buffer[24],8);assert.equal(buffer[25],6);
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),parts=[];
  for(let offset=8;offset<buffer.length;){const size=buffer.readUInt32BE(offset);if(buffer.toString('ascii',offset+4,offset+8)==='IDAT')parts.push(buffer.subarray(offset+8,offset+8+size));offset+=size+12;}
  const pixels=inflateSync(Buffer.concat(parts));for(let y=0;y<height;y++)assert.equal(pixels[y*(width*4+1)],0);
  return {width,height,pixel:(x,y)=>[...pixels.subarray(y*(width*4+1)+1+x*4,y*(width*4+1)+5+x*4)]};
}
function contrast(a,b){
  const luminance=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for(const [mode,surface] of [['light','#FFFFFF'],['dark','#1C1C1E']]){
  test(`raised ${mode} slider keeps exact layout, icons, state and portable controls`,async()=>{
    const before=await source(mode),snapshot=structuredClone(before),input=sliderClarityStudy(before);
    const after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
    await validatePanelBundle(after,core);await validatePanelBundle(before,core);assert.deepEqual(before,snapshot);assertSliderClarityStudy(before,after);
    const native=await createUnityDocument(after,core);assert.equal(native.controls.length,6);
    for(const node of nodesOf(after.componentBundle.document).filter(node=>node.type==='Slider')){
      const a=node.props.appearance;assert.equal(a.thumbCanvas.width,72);assert.equal(a.track.layout.height,12);
      for(const pos of Object.values(a.thumbPositions)){assert(pos.x>=0&&pos.y>=0);assert(pos.x+a.thumbCanvas.width<=a.sourceCanvas.width);assert(pos.y+a.thumbCanvas.height<=a.sourceCanvas.height);}
    }
    assert.throws(()=>compilePanel(after.spec,after.catalog,core,after.state,after.assetClosure,'0.22.0'),error=>error.code==='COMPILER_VERSION');
  });
  test(`raised ${mode} thumb has an opaque contrasting rim, white face and soft shadow`,()=>{
    const palette=raisedSliderPalette(surface),image=decoded(raisedSliderThumb(2,palette));assert.equal(image.width,72);assert.equal(image.height,72);
    assert(contrast(palette.edge,surface)>=3);assert(contrast(palette.track,surface)>=3);
    assert.deepEqual(image.pixel(36,32),[255,255,255,255]);assert.deepEqual(image.pixel(8,32),[1,3,5].map(i=>parseInt(palette.edge.slice(i,i+2),16)).concat(255));
    assert(image.pixel(36,64)[3]>0&&image.pixel(36,64)[3]<255);
    for(let y=0;y<72;y++)for(let x=0;x<72;x++){const p=image.pixel(x,y);if(p[3]===0)assert.deepEqual(p,[0,0,0,0]);}
    assert.deepEqual(image.pixel(0,0),[0,0,0,0]);assert.deepEqual(image.pixel(71,71),[0,0,0,0]);
  });
}
test('raised treatment leaves switches/progress alone and rejects unrelated theme profiles or business drift',async()=>{
  const before=await source('light'),input=sliderClarityStudy(before),tokens=input.catalog.themes[0].tokens;
  for(const kind of ['switch','progress','input'])assert.deepEqual(minimalControlSkin(kind,{width:200,height:56},tokens,14,2,true,'raised-v1'),minimalControlSkin(kind,{width:200,height:56},tokens,14,2,true));
  const after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  for(const mutate of [value=>value.state.volume=5,value=>value.spec.layout.padding=32,value=>value.catalog.themes[0].tokens.accent='#FF0000']){
    const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertSliderClarityStudy(before,changed));
  }
  input.catalog.themes[0].sliderStyle='unknown';assert.throws(()=>validateCatalog(input.catalog),/raised-v1 sliders require/);
  before.spec.provenance.kind='agent-authored';assert.throws(()=>sliderClarityStudy(before),/FIXTURE_ONLY/);
});
