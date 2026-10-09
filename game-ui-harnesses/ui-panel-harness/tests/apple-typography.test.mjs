import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createApplePanelSample} from '../examples/apple-panel-samples-v1/fixture.mjs';
import {polishAppleSuite} from '../examples/apple-suite-polish-v1/fixture.mjs';
import {typographyStudy,typefaces} from '../examples/apple-typography-v1/fixture.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const minimal=await json('../examples/modern-minimal.catalog.json');
for(const mode of ['light','dark']){
  const catalog=structuredClone(minimal),theme=catalog.themes.find(theme=>theme.id===`modern-mint-${mode}`);
  Object.assign(theme,{surfaceStyle:'grouped-v1',iconStyle:'plain-v1',sliderStyle:'raised-v1'});
  Object.assign(theme.tokens,{fontFamily:'Segoe UI, Microsoft YaHei UI, sans-serif',fontSize:17,headingSize:17,titleSize:32,radius:14});
  const base=await json('../examples/audio-settings.panel.json');
  const source={compilerVersion:'0.23.0',spec:{...base,theme:{id:theme.id,version:theme.version},provenance:{kind:'programmatic-fixture'},layout:{width:500,padding:28,gap:24,sectionGap:20,labelWidth:112,rowHeight:56,titleHeight:44,sectionTitleHeight:24,maxHeight:600,overflow:'error'}},catalog};
  for(const id of ['profile','exit']){
    const pair=createApplePanelSample(id,mode,source,minimal),raw=await createPanelBundle(pair.after.spec,pair.after.catalog,core),polished=polishAppleSuite(raw);
    const before=await createPanelBundle(polished.spec,polished.catalog,core);
    for(const face of typefaces)test(`typography ${id} ${mode} ${face.id}: only font family changes`,async()=>{
      const snapshot=structuredClone(before),input=typographyStudy(before,face.id),after=await createPanelBundle(input.spec,input.catalog,core,before.state);
      await validatePanelBundle(after,core);assert.deepEqual(before,snapshot);assert.equal(after.compilerVersion,before.compilerVersion);
      for(const field of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[field],before[field]);
      assert.deepEqual({...after.spec,theme:before.spec.theme},before.spec);
      const normalized=structuredClone(after.componentBundle.document);
      for(const node of nodesOf(normalized)){assert.equal(node.props.style.fontFamily,face.family);node.props.style.fontFamily=theme.tokens.fontFamily;}
      assert.deepEqual(normalized,before.componentBundle.document,'same copy, positions, sizes, line height, weight, colors and controls');
      assert.deepEqual(after.componentBundle.resources,before.componentBundle.resources);
      const oldNative=await createUnityDocument(before,core),newNative=await createUnityDocument(after,core);
      assert.deepEqual(newNative.nodes,oldNative.nodes,'UGUI source structure stays exact; it does not embed these environment fonts');
    });
    test(`typography ${id} ${mode}: rejects model results, unknown fonts and substituted family`,()=>{
      const model=structuredClone(before);model.spec.provenance.kind='agent-authored';assert.throws(()=>typographyStudy(model,'noto'),/TYPOGRAPHY_FIXTURE_ONLY/);
      assert.throws(()=>typographyStudy(before,'unknown'),/TYPOGRAPHY_FACE/);
      const other=structuredClone(before);other.catalog.themes.find(theme=>theme.id===before.spec.theme.id&&theme.version===before.spec.theme.version).tokens.fontFamily='serif';
      assert.throws(()=>typographyStudy(other,'noto'),/TYPOGRAPHY_SOURCE/);
    });
  }
}
