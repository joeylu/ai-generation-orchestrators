/** Authored ratio edits. These fixtures do not claim a natural-language model pass. */
import {initialWrapFixture,initialWrapIntent} from '../initial-text-wrap-v1/fixture.mjs';
import {materializePanelIntent} from '../../src/panel-intent.mjs';
import {createPanelBundle} from '../../src/panel-bundle.mjs';
import {createPanelEditContext} from '../../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../../src/codex-edit-draft.mjs';
import {applyPanelPatch} from '../../src/patch.mjs';
export async function panelFrameFixtures(catalog,core) {
  const {context}=await initialWrapFixture(catalog);
  const intent=initialWrapIntent(context,'角色名会展示给其他玩家，请使用喜欢的昵称。\n\n确认前可以继续修改。\n\n取消仅通知，不清空输入。');
  const before=await createPanelBundle((await materializePanelIntent(context,intent)).spec,catalog,core,{row1:'蓝莓玩家'});
  let current=before;const steps=[];
  for(const [id,text,operation] of [
    ['landscape','把实际面板改成16:9横版，宽640，保留字号、角色名输入和确认取消行为。',{op:'set-panel-ratio',ratio:{width:16,height:9},width:640}],
    ['portrait','改成9:16竖版，宽480，保留内容、字号和当前输入。',{op:'set-panel-ratio',ratio:{width:9,height:16},width:480}],
    ['natural','取消固定比例，恢复按内容自适应高度，保留当前宽度和输入。',{op:'set-panel-frame',frame:null}],
  ]) {
    const request={requestVersion:'0.1',id:'panel-edit',target:'pixi',text};
    const editContext=await createPanelEditContext(current.spec,catalog,request,null,{panelFrame:true});
    const draft={codexEditDraftVersion:'0.3',contextSha256:editContext.sha256,patch:{patchVersion:'0.1',baseSpecSha256:editContext.baseSpecSha256,reason:text,operations:[operation]},bases:[{kind:'request-interpretation',quote:text}],unresolved:[],noChange:null};
    const proposal=await materializeCodexEditDraft(editContext,draft);
    const after=await createPanelBundle((await applyPanelPatch(current.spec,proposal.patch)).spec,catalog,core,current.state);
    steps.push({id,request,context:editContext,proposal,after});current=after;
  }
  return {before,steps};
}
