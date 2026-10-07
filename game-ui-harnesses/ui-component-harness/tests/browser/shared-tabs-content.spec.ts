import {test,expect} from '@playwright/test';
import {createBundle} from '../../src/bundle.ts';
test('all explicitly shared Tabs content mappings stay visible across real category choices',async({page})=>{
 const style={backgroundColor:'#EFE9D0',borderColor:'#315050',borderWidth:1,cornerRadius:0,textColor:'#123333',fontFamily:'Arial',fontSize:18,fontWeight:'normal' as const,opacity:1};
 const bundle=await createBundle({schemaVersion:'0.2',id:'shared-content-fixture',canvas:{width:360,height:240},root:{id:'categories',type:'Tabs',layout:{x:0,y:0,width:360,height:240},props:{activeId:'all',tabs:['all','tools','food'].map(id=>({id,label:id,contentId:'actual-shared-content'})),enabled:true,style},children:[{id:'actual-shared-content',type:'Text',layout:{x:0,y:60,width:350,height:40},props:{text:'One actual shared content node',wrap:'none',overflow:'error',lineHeight:40,style}}]}},[],{kind:'programmatic-fixture',description:'Shared Tabs content regression, no hidden placeholder pages.'});
 await page.goto('/');await page.locator('#open-bundle').setInputFiles({name:'shared.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
 await expect.poll(()=>page.evaluate(()=>window.uiStudio.snapshot().ready)).toBe(true);
 const canvas=page.locator('#main-preview canvas');
 for(const [index,id]of ['all','tools','food','all'].entries()){
  const option=['all','tools','food'].indexOf(id),box=await canvas.boundingBox();await canvas.click({position:{x:(option*120+60)/360*box!.width,y:20/240*box!.height}});
  const state=await page.evaluate(()=>window.uiStudio.snapshot().views[0].inspection.nodes);
  expect(state.find(n=>n.id==='categories')?.value).toBe(id);expect(state.find(n=>n.id==='actual-shared-content')?.visible,`choice ${index}`).toBe(true);
 }
});
