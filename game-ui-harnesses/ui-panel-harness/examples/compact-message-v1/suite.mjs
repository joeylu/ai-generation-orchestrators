import {PANEL_COPY_FIX_SUITE,panelCopyFixFixture} from '../panel-copy-fix-v1/suite.mjs';
export const COMPACT_MESSAGE_SOURCE_PLAN_SHA256='4e3419e8a82b46b362ec0c4ec3a78d76e827935182703dd6f5e61bd5ae353311';
export const COMPACT_MESSAGE_SUITE=PANEL_COPY_FIX_SUITE.map(item=>structuredClone(item));
/** An offline driver answer only; not a model response or prompt content. */
export function compactMessageFixture(context,item,reference){
  const intent=panelCopyFixFixture(context,item,reference);
  if(item.stability.purpose==='exit-confirmation'&&intent.panel){
    const visit=node=>{if(node.kind==='tabs')node.pages.forEach(page=>visit(page.body));else if(node.kind==='section'){for(const row of node.rows)if(row.kind==='text')row.recipeKey='message.text@0.2.0';}else node.children.forEach(visit);};
    visit(intent.panel.body);
  }
  return intent;
}
