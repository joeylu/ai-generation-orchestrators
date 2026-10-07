/** Program-authored composite edits; no model success is claimed. */
import {panelFrameFixtures} from '../panel-frame-v1/fixture.mjs';
import {LAYOUT_DETAIL_KEYS} from '../../src/layout-details.mjs';
import {createPanelEditContext} from '../../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../../src/codex-edit-draft.mjs';
import {applyPanelPatch} from '../../src/patch.mjs';
import {createPanelBundle} from '../../src/panel-bundle.mjs';
export async function layoutDetailsFixtures(catalog,core){
 const {before}=await panelFrameFixtures(catalog,core);let current=before;const steps=[];
 const details=values=>({op:'set-layout-details',details:{...Object.fromEntries(LAYOUT_DETAIL_KEYS.map(key=>[key,null])),...values}});
 for(const [id,text,operations]of [
  ['portrait','改成9:16竖版，宽480，内边距24，标题区域高56，间距12，保留字号、当前输入和按钮行为。',[{op:'set-panel-ratio',ratio:{width:9,height:16},width:480},details({padding:24,titleHeight:56,gap:12})]],
  ['landscape','改成16:9横版，宽800，内边距20，标题区域高48，间距16，保留字号、当前输入和按钮行为。',[details({padding:20,titleHeight:48,gap:16}),{op:'set-panel-ratio',ratio:{width:16,height:9},width:800}]],
 ]){
  const request={requestVersion:'0.1',id:'panel-edit',target:'pixi',text};
  const context=await createPanelEditContext(current.spec,catalog,request,null,{layoutDetails:true});
  const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:text,operations},bases:operations.map(()=>({kind:'request-interpretation',quote:text})),unresolved:[],noChange:null};
  const proposal=await materializeCodexEditDraft(context,draft);
  const after=await createPanelBundle((await applyPanelPatch(current.spec,proposal.patch)).spec,catalog,core,current.state);
  steps.push({id,request,context,proposal,after});current=after;
 }
 return {before,steps};
}
