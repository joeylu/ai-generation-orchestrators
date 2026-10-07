/** Authored acceptance input, including an intentionally incomplete proposal. */
import {initialWrapFixture,initialWrapIntent} from '../initial-text-wrap-v1/fixture.mjs';
import {materializePanelIntent} from '../../src/panel-intent.mjs';
import {createPanelBundle} from '../../src/panel-bundle.mjs';
import {createPanelEditContext,requireReadyEditProposal} from '../../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../../src/codex-edit-draft.mjs';
import {applyPanelPatch} from '../../src/patch.mjs';
import {LAYOUT_DETAIL_KEYS} from '../../src/layout-details.mjs';
export async function editReviewFixture(catalog,core){
 const {context:generationContext}=await initialWrapFixture(catalog);
 const generationProposal=await materializePanelIntent(generationContext,initialWrapIntent(generationContext,'请填写喜欢的角色名。\n\n确认前可以继续修改，取消仅通知。'));
 const before=await createPanelBundle(generationProposal.spec,catalog,core,{row1:'蓝莓玩家'});
 const request={requestVersion:'0.1',id:'panel-edit',target:'pixi',text:'改成9:16竖版，宽480，内边距28，标题区域高56，间距14，保留字号、当前输入和按钮行为。'};
 const context=await createPanelEditContext(before.spec,catalog,request,null,{requestChecks:true});
 const ratio={op:'set-panel-ratio',ratio:{width:9,height:16},width:480};
 const operations=[ratio,{op:'set-layout-details',details:{...Object.fromEntries(LAYOUT_DETAIL_KEYS.map(key=>[key,null])),padding:28,titleHeight:56,gap:14}}];
 const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:request.text,operations},bases:operations.map(()=>({kind:'request-interpretation',quote:request.text})),unresolved:[],noChange:null};
 const complete=await materializeCodexEditDraft(context,draft);await requireReadyEditProposal(context,complete);
 const partial={...complete,patch:{...complete.patch,operations:[ratio]},decisions:[complete.decisions[0]]};
 const after=await createPanelBundle((await applyPanelPatch(before.spec,complete.patch)).spec,catalog,core,before.state);
 return {generationContext,generationProposal,before,request,context,partial,complete,after};
}
