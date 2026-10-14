import {PANEL_STABILITY_FIX_SUITE} from '../panel-stability-fix-v1/suite.mjs';
import {commonGamePanelFixture} from '../common-game-panels-v1/suite.mjs';
export const COPY_FIX_SOURCE_PLAN_SHA256='20810fdd77f126e988111a0afd2adea73e9f65e2826ff053b2ad274586cac5fa';
export const PANEL_COPY_FIX_SUITE=PANEL_STABILITY_FIX_SUITE.map(item=>structuredClone(item));
/** Offline fixture only; never sent as a model answer. */
export function panelCopyFixFixture(context,item,reference){
  const intent=commonGamePanelFixture(context,item,reference);
  if(item.stability.purpose!=='exit-confirmation'||!intent.panel)return intent;
  const visit=node=>{
    if(node.kind==='tabs')node.pages.forEach(page=>visit(page.body));
    else if(node.kind==='section'){for(const row of node.rows)if(row.kind==='text')row.recipeKey='message.text@0.1.0';}
    else node.children.forEach(visit);
  };
  visit(intent.panel.body);return intent;
}
