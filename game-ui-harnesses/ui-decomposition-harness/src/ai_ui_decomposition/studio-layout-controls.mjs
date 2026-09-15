import assert from 'node:assert/strict';
import {selectLayoutChecks} from './select-layout-browser.mjs';
import {buttonLineChecks} from './button-label-lines-browser.mjs';
export async function checkStudioLayoutControls({page,canvas,nodes,snapshot,get,point,focus,shot,report}) {
 for(const node of nodes.filter(n=>n.type==='Select'&&n.props.appearance?.popupContentLayout)) {
  const before=get(await snapshot(),node.id),b=before.bounds;
  await page.mouse.click(...await point(b.x+b.width/2,b.y+b.height/2));
  await page.waitForFunction(id=>window.uiStudio.snapshot().views[0].inspection.nodes.find(n=>n.id===id).popupOpen,node.id);
  const checks=selectLayoutChecks(node,get(await snapshot(),node.id));assert.ok(checks.every(c=>c.pass),'STUDIO_SELECT_LAYOUT');
  report.checks.push({componentId:node.id,name:'real mouse opened menu layout',status:'passed',checks});await shot(`select-${node.id}-opened`);
  await canvas.focus();await page.keyboard.press('Escape');
  await page.waitForFunction(id=>!window.uiStudio.snapshot().views[0].inspection.nodes.find(n=>n.id===id).popupOpen,node.id);
  assert.equal(get(await snapshot(),node.id).value,before.value,'STUDIO_SELECT_ESCAPE_VALUE');
 }
 for(const node of nodes.filter(n=>n.type==='Button'&&n.props.appearance?.labelLines)) {
  await page.mouse.move(1,1);await canvas.evaluate(c=>c.blur());await page.waitForTimeout(160);
  const before=get(await snapshot(),node.id),b=before.bounds;
  for(const source of ['mouse','keyboard']) {
   const initial=(await snapshot()).events.filter(e=>e.id===node.id&&e.type==='activate').length;
   if(source==='mouse')await page.mouse.click(...await point(b.x+b.width/2,b.y+b.height/2));
   else {await focus(node.id);await page.keyboard.press('Space');}
   await page.mouse.move(1,1);await canvas.evaluate(c=>c.blur());await page.waitForTimeout(160);
   const s=await snapshot(),events=s.events.filter(e=>e.id===node.id&&e.type==='activate').slice(initial),checks=buttonLineChecks(node,get(s,node.id),b);
   assert.equal(events.length,1,'STUDIO_BUTTON_ACTIVATION_COUNT');assert.equal(events[0].source,source);assert.ok(checks.every(c=>c.pass),'STUDIO_BUTTON_LABEL_LINES');
   report.checks.push({componentId:node.id,name:`real ${source} Button lines`,status:'passed',events,checks});await shot(`button-${node.id}-${source}`);
  }
 }
}
