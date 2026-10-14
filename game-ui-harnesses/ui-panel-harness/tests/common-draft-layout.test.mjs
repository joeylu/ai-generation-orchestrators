import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {fitDraftPanelLayout} from '../src/draft-layout.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
const core=await loadWorkspaceCore(),catalog=await readJson(new URL('../examples/modern-action-headings.catalog.json',import.meta.url));
const {fixtures}=await readJson(new URL('./fixtures/common-draft-layout-v2.json',import.meta.url));
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
const scrub=value=>{const copy=structuredClone(value);delete copy.canvas;delete copy.layout.width;delete copy.layout.maxHeight;return copy;};
for(const fixture of fixtures)test(`${fixture.id}: all page content fits while business, state and internal list scrolling are preserved`,async()=>{
  const assets=fixture.assets?{closure:fixture.assets.closure,resources:fixture.assets.resources.map(({base64,...resource})=>({...resource,bytes:Buffer.from(base64,'base64')}))}:undefined;
  const original=await createPanelBundle(fixture.spec,catalog,core,undefined,assets),before=structuredClone(fixture.spec);
  const fitted=fitDraftPanelLayout(fixture.spec,catalog,core,{policy:'draft-content-fit-v2',assetClosure:assets?.closure,mutableDimensions:['width','maxHeight','canvasWidth','canvasHeight']});
  assert.equal(fitted.evidence.status,'CONTENT_VISIBLE');assert.deepEqual(fixture.spec,before);assert.deepEqual(scrub(fitted.spec),scrub(before));
  const bundle=await createPanelBundle(fitted.spec,catalog,core,original.state,assets);await validatePanelBundle(bundle,core);
  assert.deepEqual(bundle.assetClosure,original.assetClosure);
  assert.deepEqual(bundle.actions,original.actions);assert.deepEqual(bundle.state,original.state);assert.deepEqual(bundle.bindings,original.bindings);
  const bodies=new Set(before.tabs?before.tabs.pages.map(page=>before.id+'.page.'+page.id):[before.id+'.body']);
  assert(!flatten(bundle.componentBundle.document.root).some(node=>bodies.has(node.id)&&node.type==='ScrollView'));
  const lists=b=>flatten(b.componentBundle.document.root).filter(node=>node.type==='ScrollView'&&node.id.endsWith('.viewport')).map(node=>({id:node.id,height:node.layout.height,contentHeight:node.props.contentHeight}));
  assert.deepEqual(lists(bundle),lists(original));
  assert.deepEqual(fitDraftPanelLayout(fitted.spec,catalog,core,{policy:'draft-content-fit-v2',assetClosure:assets?.closure,mutableDimensions:['width','maxHeight','canvasWidth','canvasHeight']}).spec,fitted.spec);
});
test('tab sizing remains opt-in, and fixed dimensions cannot be silently expanded',()=>{
  const spec=fixtures.find(item=>item.id==='G59').spec;
  assert.throws(()=>fitDraftPanelLayout(spec,catalog,core),{code:'DRAFT_LAYOUT_SCOPE'});
  const fixed=fitDraftPanelLayout(spec,catalog,core,{policy:'draft-content-fit-v2'});
  assert.deepEqual(fixed.spec,spec);assert.equal(fixed.evidence.status,'FIXED_DIMENSIONS_REQUIRE_SCROLL');
  assert.throws(()=>fitDraftPanelLayout(spec,catalog,core,{policy:'unreviewed'}),{code:'DRAFT_LAYOUT_POLICY'});
});
test('generation measures unspecified draft heights for current themes and preserves explicit and historical height limits',async()=>{
  const original=fixtures.find(x=>x.id==='G59').spec;
  const body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
  const settings={width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(original.layout.body),sourceQuote:null};
  const theme=catalog.themes.find(x=>x.id===original.theme.id&&x.version===original.theme.version);
  const before=structuredClone(original),arranged=arrangeIntentSpec(structuredClone(original),settings,theme,catalog);
  assert.deepEqual(original,before);assert.deepEqual(arranged.sections,original.sections);assert.deepEqual(arranged.state,original.state);assert.deepEqual(arranged.tabs,original.tabs);
  const bundle=await createPanelBundle(arranged,catalog,core);
  assert(!flatten(bundle.componentBundle.document.root).some(x=>x.type==='ScrollView'&&x.id.startsWith(original.id+'.page.')));
  for(const overrides of [{maxHeight:560},{canvasHeight:624},{overflow:'scroll'}]){
    const fixed=arrangeIntentSpec(structuredClone(original),{...settings,...overrides},theme,catalog);
    assert.equal(fixed.layout.maxHeight,560);
  }
  const historical=arrangeIntentSpec(structuredClone(original),settings,{...theme,headingStyle:'concise-v2'},catalog);
  assert.equal(historical.layout.maxHeight,560);
});
