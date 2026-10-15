import assert from 'node:assert/strict';

// Exercises the shipped consumer runtime, including detached popup/state views.
export async function checkTextColors(page){
 const result=await page.evaluate(async()=>{
  if(!harness.skin.profile.textColors)return {status:'not-assessed',reason:'legacy-theme'};
  const byType={};
  for(const type of ['Button','Input','Select','List','Tabs','Dialog','Panel','ScrollView','Text']){
   harness.clear();window.current=harness.make(type);harness.runtime.flush();
   byType[type]=harness.runtime.textColors.refresh();
  }
  harness.clear();window.current=harness.make('Select');harness.runtime.flush();
  return {status:'passed',byType,inks:harness.skin.profile.textColors};
 });
 if(result.status==='not-assessed')return result;
 const includes=(rows,role)=>assert(rows.some(r=>r.role===role),'Missing text on '+role);
 for(const [type,role]of Object.entries({Button:'skin.button.primary.normal',Input:'skin.field.normal',Select:'skin.field.normal',List:'skin.item.normal',Tabs:'skin.tab.selected',Dialog:'skin.surface.panel',Panel:'skin.surface.panel',ScrollView:'skin.surface.content',Text:'host-background'}))includes(result.byType[type],role);
 includes(result.byType.Tabs,'skin.surface.content');
 for(const rows of Object.values(result.byType))for(const row of rows)if(row.role!=='host-background')assert.equal(row.fill,result.inks[row.role]);
 const click=async expression=>{const point=await page.evaluate(expr=>{harness.runtime.flush();const b=Function('return '+expr)().getBounds();return {x:b.x+b.width/2,y:b.y+b.height/2};},expression);await page.mouse.click(point.x,point.y);};
 await click('current.adapter.view');
 const popup=await page.evaluate(()=>{harness.runtime.flush();return harness.runtime.textColors.refresh();});includes(popup,'skin.item.normal');
 await page.evaluate(()=>{harness.clear();window.current=harness.make('Tabs');harness.runtime.flush();});
 await click('current.adapter.rows[1]');
 const tabs=await page.evaluate(()=>{harness.runtime.flush();return {state:current.readState(),rows:harness.runtime.textColors.refresh()};});
 assert.equal(tabs.state.activeId,'b');includes(tabs.rows,'skin.tab.selected');
 includes(tabs.rows,'skin.surface.content');
 const selected=tabs.rows.find(r=>r.role==='skin.tab.selected');assert.equal(selected.text,'第二页');
 await page.evaluate(()=>{harness.clear();window.current=harness.make('Button');harness.runtime.flush();});
 const point=await page.evaluate(()=>{const b=current.root.getBounds();return {x:b.x+b.width/2,y:b.y+b.height/2};});
 await page.mouse.move(point.x,point.y);await page.mouse.down();
 const pressed=await page.evaluate(()=>{harness.runtime.flush();return harness.runtime.textColors.refresh();});includes(pressed,'skin.button.primary.pressed');
 await page.mouse.up();
 await page.evaluate(()=>{harness.clear();window.current=harness.make('Button',{props:{enabled:false}});harness.runtime.flush();});
 const disabled=await page.evaluate(()=>harness.runtime.textColors.refresh());
 assert(disabled.some(r=>r.compositingReview),'Disabled alpha must remain a compositing review, not a proven contrast pass');
 for(const rows of [popup,pressed,tabs.rows,disabled])for(const row of rows)if(row.role!=='host-background')assert.equal(row.fill,result.inks[row.role]);
 const host=await page.evaluate(async()=>{const {Text}=await import('./runtime.mjs');const text=new Text({text:'Host owned',style:{fill:'#123456'}});text.position.set(500,500);harness.app.stage.addChild(text);harness.runtime.flush();const fill=text.style.fill;text.destroy();return fill;});
 assert.equal(host,'#123456');
 return {...result,popup,pressed,tabs,disabled,hostTextPreserved:true,scope:'role-color-routing-and-state-transitions'};
}
