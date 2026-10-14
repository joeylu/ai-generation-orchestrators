import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {digestJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
const record=await readJson(new URL('./fixtures/panel-stability-image-fit-v1.json',import.meta.url)),catalog=await readJson(new URL('../examples/modern-tab-headings.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
catalog.themes=catalog.themes.filter(theme=>theme.id==='modern-mint-light');
test('saved 128px placeholder rejects its long label; an explicit width-only patch fits without changing copy, actions or defaults',async()=>{
  const before=structuredClone(record.spec),image=record.spec.sections.flatMap(section=>section.rows).find(row=>row.kind==='image');assert.equal(image.width,128);assert.equal(image.source,null);
  await assert.rejects(createPanelBundle(record.spec,catalog,core),{code:'IMAGE_PLACEHOLDER_LABEL'});assert.deepEqual(record.spec,before);
  const operation={op:'set-image-properties',rowId:image.id,assetLibrary:null,source:null,width:'fill',height:image.height,fit:image.fit};
  const {spec}=await applyPanelPatch(record.spec,{patchVersion:'0.1',baseSpecSha256:await digestJson(record.spec),reason:'Explicit width-only correction of the reviewed placeholder.',operations:[operation]});
  const expected=structuredClone(before);expected.sections.flatMap(section=>section.rows).find(row=>row.id===image.id).width='fill';assert.deepEqual(spec,expected);
  const bundle=await createPanelBundle(spec,catalog,core);assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  assert.deepEqual(bundle.state,Object.fromEntries(before.state.map(field=>[field.id,field.initial])));assert.deepEqual(record.spec,before);
});
