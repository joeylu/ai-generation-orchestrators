import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createApplePanelSample} from '../examples/apple-panel-samples-v1/fixture.mjs';
import {polishAppleSuite} from '../examples/apple-suite-polish-v1/fixture.mjs';
import {typographyStudy} from '../examples/apple-typography-v1/fixture.mjs';
import {compactActionsStudy} from '../examples/compact-actions-v1/fixture.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [minimal,base]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/audio-settings.panel.json')]);
async function source(id,mode){
  const catalog=structuredClone(minimal),theme=catalog.themes.find(theme=>theme.id===`modern-mint-${mode}`);
  Object.assign(theme,{surfaceStyle:'grouped-v1',iconStyle:'plain-v1',sliderStyle:'raised-v1'});
  Object.assign(theme.tokens,{fontFamily:'Segoe UI, Microsoft YaHei UI, sans-serif',fontSize:17,headingSize:17,titleSize:32,radius:14});
  const seed={compilerVersion:'0.23.0',spec:{...base,theme:{id:theme.id,version:theme.version},provenance:{kind:'programmatic-fixture'},layout:{width:500,padding:28,gap:24,sectionGap:20,labelWidth:112,rowHeight:56,titleHeight:44,sectionTitleHeight:24,maxHeight:600,overflow:'error'}},catalog};
  const pair=createApplePanelSample(id,mode,seed,minimal),raw=await createPanelBundle(pair.after.spec,pair.after.catalog,core),input=polishAppleSuite(raw);
  let bundle=await createPanelBundle(input.spec,input.catalog,core);
  if(id==='exit'){const font=typographyStudy(bundle,'noto');bundle=await createPanelBundle(font.spec,font.catalog,core);}
  return bundle;
}
for(const mode of ['light','dark'])for(const id of ['pause','exit']){
  const before=await source(id,mode),input=compactActionsStudy(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state);
  test(`compact ${id} ${mode}: original compiler, palette, font and actions retained`,async()=>{
    const snapshot=structuredClone(before);await validatePanelBundle(before,core);await validatePanelBundle(after,core);assert.deepEqual(before,snapshot);
    for(const key of ['compilerVersion','catalog','state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
    for(const key of ['canvas','assets','theme','state','buttonFonts','textLayouts'])assert.deepEqual(after.spec[key],before.spec[key]);
    const normalized=structuredClone(after.spec.sections);
    if(id==='exit'){
      const row=after.spec.sections[0].rows[0];assert.equal(row.label+'\n'+row.text,before.spec.sections[0].rows[0].text);
      Object.assign(normalized[0].rows[0],{label:before.spec.sections[0].rows[0].label,text:before.spec.sections[0].rows[0].text});
    }
    assert.deepEqual(normalized,before.spec.sections);assert.equal(after.spec.titleBar.fontSize,22);assert.equal(after.spec.titleBar.horizontalAlign,'left');
  });
  test(`compact ${id} ${mode}: full plate, aligned actions and compact height`,()=>{
    const nodes=new Map(nodesOf(after.componentBundle.document).map(node=>[node.id,node])),prefix=after.spec.id;
    const panel=nodes.get(prefix+'.panel'),buttons=[...nodes.values()].filter(node=>node.type==='Button');
    assert.equal(panel.props.style.cornerRadius,20);assert.equal(panel.layout.height,id==='pause'?296:244);
    for(const button of buttons){assert.equal(button.layout.height,44);assert.equal(button.props.style.borderWidth,0);}
    if(id==='pause'){
      for(const button of buttons){assert.equal(button.layout.x,0);assert.equal(button.layout.width,372);}
      assert.deepEqual(buttons.map(button=>button.layout.y),[6,70,134]);
      assert.equal(buttons[2].props.style.textColor,input.catalog.themes.find(theme=>theme.id===input.spec.theme.id&&theme.version===input.spec.theme.version).tokens.muted);
    }else{
      assert.equal(nodes.get(prefix+'.row.message.label').props.text,'确定要离开当前游戏吗？');
      assert.equal(nodes.get(prefix+'.row.message.control').props.text,'请先保存进度，避免丢失本次游戏记录。');
      assert.equal(buttons[1].layout.x+buttons[1].layout.width,372);assert.equal(buttons[0].layout.y,buttons[1].layout.y);
      assert.equal(buttons[1].layout.x-buttons[0].layout.x-buttons[0].layout.width,12);
    }
  });
  test(`compact ${id} ${mode}: UGUI controls and business unchanged`,async()=>{
    const oldNative=await createUnityDocument(before,core),native=await createUnityDocument(after,core);
    assert.deepEqual(native.fields,oldNative.fields);assert.deepEqual(native.controls,oldNative.controls);assert.deepEqual(native.assets,oldNative.assets);
    assert(!native.nodes.some(node=>node.id.endsWith('.center-label')));assert.equal(native.nodes.find(node=>node.id===after.spec.id+'.title').textAlignment,'MiddleLeft');
  });
  test(`compact ${id} ${mode}: model provenance, substituted rows and unsupported inputs rejected`,()=>{
    const model=structuredClone(before);model.spec.provenance.kind='agent-authored';assert.throws(()=>compactActionsStudy(model),/COMPACT_ACTIONS_FIXTURE_ONLY/);
    const rows=structuredClone(before);rows.spec.sections[0].rows.reverse();assert.throws(()=>compactActionsStudy(rows),/COMPACT_ACTIONS_ROWS/);
    const other=structuredClone(before);other.compilerVersion='0.25.0';assert.throws(()=>compactActionsStudy(other),/COMPACT_ACTIONS_FIXTURE_ONLY/);
  });
}
