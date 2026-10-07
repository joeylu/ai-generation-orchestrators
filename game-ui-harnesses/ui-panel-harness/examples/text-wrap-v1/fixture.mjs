/** Authored fixture: no inference or model-generated success is claimed. */
import { roleRequest, roleIntent } from '../adaptive-v1/fixture.mjs';
import { createPlanningContext } from '../../src/planning-context.mjs';
import { materializePanelIntent } from '../../src/panel-intent.mjs';
import { createPanelBundle } from '../../src/panel-bundle.mjs';
import { createPanelEditContext } from '../../src/edit-planning.mjs';

export const wrapBody = '名字会展示给其他玩家，请选择一个喜欢的角色名。确认前可以继续修改，取消将保留本次输入。正文按可用宽度自动换行，后面的输入框和按钮应随内容高度下移。 English words stay together; a long URL can break safely: https://example.test/this-is-a-very-long-address-for-wrapping';
export const wrapRequest = '将提示正文改为下面内容并自动换行，按内容调整高度，后面的输入框和按钮下移，保留输入值和确认取消行为。正文：' + wrapBody;
export async function createTextWrapFixture(catalog, core) {
  const planning = await createPlanningContext(roleRequest, catalog);
  const spec = (await materializePanelIntent(planning, roleIntent(planning))).spec;
  spec.canvas.height = 640;
  spec.sections[0].rows.unshift({ id:'intro', kind:'text', label:'命名说明', text:'请输入角色名', recipe:{id:'settings.text',version:'0.1.0'} });
  spec.provenance = { kind:'programmatic-fixture', description:'Authored static body wrapping fixture.', assumptions:[] };
  const before = await createPanelBundle(spec, catalog, core, {row0:'小蓝莓😀'});
  const context = await createPanelEditContext(spec, catalog, {requestVersion:'0.1',id:'panel-edit',text:wrapRequest,target:'pixi'});
  const operations = [{op:'set-text',rowId:'intro',text:wrapBody},{op:'set-text-wrap',rowId:'intro',wrap:'word'}];
  const proposal = {editProposalVersion:'0.1',contextSha256:context.sha256,
    patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Fixture: body wraps without changing actions.',operations},
    decisions:operations.map((_,operationIndex)=>({operationIndex,basis:{kind:'request-interpretation',start:0,end:wrapRequest.length,quote:wrapRequest}})),unresolved:[]};
  return {before,context,proposal};
}
