/** Authored property-check acceptance. Negative proposals are intentionally invalid. */
import {createPlanningContext} from '../../src/planning-context.mjs';
import {initialWrapIntent} from '../initial-text-wrap-v1/fixture.mjs';
import {materializePanelIntent} from '../../src/panel-intent.mjs';
import {createPanelBundle} from '../../src/panel-bundle.mjs';
import {createPanelEditContext,requireReadyEditProposal} from '../../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../../src/codex-edit-draft.mjs';
import {applyPanelPatch} from '../../src/patch.mjs';
import {APPEARANCE_KEYS} from '../../src/appearance.mjs';
import {TITLE_BAR_KEYS} from '../../src/title-bar.mjs';
import {LAYOUT_DETAIL_KEYS} from '../../src/layout-details.mjs';
export async function editPropertyFixture(catalog,core){
 const body='角色名会展示给其他玩家。确认前可以继续修改，取消只通知。';
 const initial={requestVersion:'0.1',id:'property-review-role',target:'pixi',text:'生成角色命名界面，包含说明正文、角色名输入框、确认和取消按钮。角色名初始为空，必填，至少2个字符，最多12个字符，占位请输入角色名。面板宽480，高度上限560。确认提交角色名，取消仅通知。说明正文原样展示并换行：'+body};
 const generationContext=await createPlanningContext(initial,catalog,undefined,{actionLayouts:true,textWrap:true});
 const generationProposal=await materializePanelIntent(generationContext,initialWrapIntent(generationContext,body));
 const before=await createPanelBundle(generationProposal.spec,catalog,core,{row1:'蓝莓玩家'});
 const request={requestVersion:'0.1',id:'panel-edit',target:'pixi',text:'面板标题改为“角色资料”，改成蓝色主题，面板背景色改为#EAF4FF，标题字号30，确认按钮字号20，角色名默认值改为“蓝莓旅人”，其他保持不变。'};
 const context=await createPanelEditContext(before.spec,catalog,request,null,{requestChecks:'properties-v2'});
 const operations=[{op:'set-panel-title',title:'角色资料'},{op:'set-theme',theme:{id:'modern-blue-light',version:'0.4.0'}},{op:'set-appearance',appearance:{...Object.fromEntries(APPEARANCE_KEYS.map(k=>[k,null])),panelColor:'#EAF4FF'}},{op:'set-title-bar',style:{...Object.fromEntries(TITLE_BAR_KEYS.map(k=>[k,k==='padding'?0:null])),fontSize:30}},{op:'set-button-font-size',rowId:'row2',fontSize:20},{op:'set-state-initial',fieldId:'row1',value:'蓝莓旅人'}];
 const complete=await materializeCodexEditDraft(context,{codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:request.text,operations},bases:operations.map(()=>({kind:'request-interpretation',quote:request.text})),unresolved:[],noChange:null});
 await requireReadyEditProposal(context,complete);
 const partial={...complete,patch:{...complete.patch,operations:operations.slice(0,-1)},decisions:complete.decisions.slice(0,-1)};
 const overreach={...complete,patch:{...complete.patch,operations:[...operations,{op:'set-layout-details',details:{...Object.fromEntries(LAYOUT_DETAIL_KEYS.map(k=>[k,null])),gap:18}}]},decisions:[...complete.decisions,{...complete.decisions[0],operationIndex:operations.length}]};
 const after=await createPanelBundle((await applyPanelPatch(before.spec,complete.patch)).spec,catalog,core,before.state);
 return {generationContext,generationProposal,before,request,context,partial,overreach,complete,after};
}
