import {centeredMessageTextIds,compactMessageSection} from '../../src/compact-message.mjs';
import {controlId} from '../../src/compiler.mjs';
/** Offline observation of native bounds; never repairs outputs or invokes a model. */
export async function observeCompactMessage(page,bundle){
  const section=bundle.spec.sections[0],ids=centeredMessageTextIds(bundle),checks=[];
  const check=(code,pass,evidence)=>checks.push({code,status:pass?'PASS':'FAIL',...(evidence===undefined?{}:{evidence})});
  check('EXPLICIT_COMPACT_MESSAGE_RECIPE_AND_SCOPE',['0.36.0','0.37.0','0.38.0','0.39.0','0.40.0','0.41.0','0.42.0','0.43.0','0.44.0','0.45.0'].includes(bundle.compilerVersion)&&compactMessageSection(bundle.spec,section,bundle.catalog));
  const nodes=new Map((await page.evaluate(()=>window.panelDelivery.inspect())).nodes.map(node=>[node.id,node]));
  const bounds=nodes.get(`${bundle.spec.id}.section.${section.id}`)?.bounds,center=bounds?bounds.x+bounds.width/2:null;
  const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],authored=flatten(bundle.componentBundle.document.root);
  const prose=section.rows.filter(row=>row.kind==='text').flatMap(row=>{const base=controlId(bundle.spec.id,row.id);return authored.filter(node=>node.type==='Text'&&(node.id===base||node.id.startsWith(base+'.line')));});
  const centered=ids.map(id=>{const glyph=nodes.get(id)?.renderedTextBounds?.[0]?.bounds;return {id,error:glyph&&center!==null?Math.abs(glyph.x+glyph.width/2-center):null};});
  if(ids.length)check('SHORT_PROSE_CENTERED_USING_RENDERED_GLYPHS',centered.every(value=>value.error!==null&&value.error<=1),centered);
  const left=prose.filter(node=>!ids.includes(node.id)).map(node=>{const rowId=node.id.split('.control')[0],parent=nodes.get(rowId)?.bounds,current=nodes.get(node.id)?.bounds;return {id:node.id,error:parent&&current?Math.abs(current.x-parent.x-node.layout.x):null};});
  if(left.length)check('LONG_OR_PARAGRAPH_PROSE_RETAINS_AUTHORED_LEFT_EDGE',left.every(value=>value.error!==null&&value.error<=1),left);
  const buttons=section.rows.filter(row=>row.kind==='button').map(row=>nodes.get(controlId(bundle.spec.id,row.id))?.bounds);
  const sameRow=buttons.every(value=>value&&Math.abs(value.y-buttons[0].y)<=1);
  const buttonCenter=sameRow?(Math.min(...buttons.map(value=>value.x))+Math.max(...buttons.map(value=>value.x+value.width)))/2:null;
  const buttonErrors=sameRow?[Math.abs(buttonCenter-center)]:buttons.map(value=>value&&center!==null?Math.abs(value.x+value.width/2-center):null);
  check('ACTION_GROUP_CENTERED_AND_ALL_CHOICES_PRESENT',buttons.length>=2&&center!==null&&buttonErrors.every(error=>error!==null&&error<=1),{sameRow,errors:buttonErrors});
  const glyphs=prose.flatMap(node=>nodes.get(node.id)?.renderedTextBounds??[]).map(value=>value.bounds),gap=buttons.every(Boolean)&&glyphs.length?Math.min(...buttons.map(value=>value.y))-Math.max(...glyphs.map(value=>value.y+value.height)):null;
  const slots=section.rows.filter(row=>row.kind==='text').map(row=>nodes.get(`${bundle.spec.id}.row.${row.id}`)?.bounds),slotGap=buttons.every(Boolean)&&slots.every(Boolean)?Math.min(...buttons.map(value=>value.y))-Math.max(...slots.map(value=>value.y+value.height)):null;
  check('PROSE_TO_ACTION_GAP_BOUNDED',gap!==null&&gap>=0&&(gap<=bundle.spec.layout.gap+40||left.length>0&&slotGap!==null&&slotGap>=0&&slotGap<=bundle.spec.layout.gap+40),{gap,slotGap,maximum:bundle.spec.layout.gap+40});
  return {kind:'NATIVE_COMPACT_MESSAGE_OBSERVATION_NOT_HUMAN_ACCEPTANCE',status:checks.every(value=>value.status==='PASS')?'PASS':'FAIL',checks,realModelCalls:0};
}
