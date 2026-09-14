import {checkListChildren} from './stateful-list-children-browser.mjs';

export async function checkBoundTexts({page,entries,saveScreenshot}) {
 const checks=await checkListChildren({page,children:entries,resources:{},saveScreenshot});
 return checks.map(c=>({...c,slot:'bound-text/'+c.slot}));
}

export async function acceptListTextProbe({page,component,probe,saveScreenshot}) {
 const control=probe.name!=='initial',id=component.componentId;
 await page.evaluate(()=>document.querySelector('#events').replaceChildren());
 if(control)await page.evaluate(({id,value})=>window.uiHarness.setValue(id,value),{id,value:probe.value});
 await page.waitForFunction(({id,value})=>window.uiHarness.inspect().nodes.find(n=>n.id===id).value===value,{id,value:probe.value});
 const index=component.states.findIndex(s=>s.value===probe.value);
 await page.waitForFunction(({id,index})=>Math.abs((window.uiHarness.inspectMotionSystem().nodes.find(n=>n.id===id).presentation.listSelection??index)-index)<.001,{id,index});
 const shot=await saveScreenshot('state');
 const checks=await checkBoundTexts({page,entries:probe.boundTexts,saveScreenshot});
 const events=(await page.locator('#events li').allTextContents()).flatMap(t=>{try{return [JSON.parse(t)];}catch{return [];}});
 const changes=events.filter(e=>['change','input','scroll'].includes(e.type));
 checks.push({slot:'bound-text/probe-events',visible:true,events,expectedCount:Number(control),
  pass:changes.length===Number(control)&&changes.every(e=>e.id===id&&e.type==='change'&&e.source==='control'&&e.value===probe.value)});
 return {componentId:id,state:'binding-'+probe.name,inputProtocol:control?'public-api':'initial-load',actualValue:probe.value,
  basis:'contract-derived-test-only',screenshot:shot.path,screenshotSha256:shot.sha256,checks};
}
