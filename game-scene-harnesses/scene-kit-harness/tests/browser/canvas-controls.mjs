// Explicit mouse navigation for controls relocated from the former right inspector.
export async function dismissCanvasPanels(page){
 if(await page.locator('#canvas-properties').isVisible())await page.getByRole('button',{name:'关闭画布属性',exact:true}).click();
 if(await page.locator('#canvas-options').evaluate(e=>e.open))await page.locator('#canvas-options>summary').click();
}
async function options(page){
 if(await page.locator('#canvas-properties').isVisible())await page.getByRole('button',{name:'关闭画布属性',exact:true}).click();
 if(!await page.locator('#canvas-options').evaluate(e=>e.open))await page.locator('#canvas-options>summary').click();
}
export async function canvasField(page,id){
 if(['terrain-appearance','curve-template','extend','collision','cell-x','cell-y','apply-cell'].includes(id)){
  await options(page);if(id.startsWith('cell-')||id==='apply-cell')if(!await page.locator('#precision-placement').evaluate(e=>e.open))await page.locator('#precision-placement>summary').click();
 }else if(id.startsWith('curve-')||['add-curve','add-mixed'].includes(id)){
  if(await page.getByRole('button',{name:'曲线 C',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'曲线 C',exact:true}).click();
  if(!['add-curve','add-mixed'].includes(id)&&!await page.locator('#canvas-properties').isVisible())await page.getByRole('button',{name:'曲线属性',exact:true}).click();
 }else if(id.startsWith('object-')){
  if(!await page.locator('#canvas-properties').isVisible())await page.getByRole('button',{name:'对象属性',exact:true}).click();
 }
 return page.locator('#'+id);
}
export async function selectObject(page,id){
 if(!await page.locator('.inspector').isVisible())await page.getByRole('button',{name:'图层面板',exact:true}).click();
 await page.locator(`[data-instance-id="${id}"]`).dblclick();
}
export async function panCanvas(page,key){
 await dismissCanvasPanels(page);if(key==='Home')return page.locator('#home').click();
 const box=await page.locator('canvas').boundingBox(),right=key==='ArrowRight',start=box.x+box.width*(right?.75:.25),end=box.x+box.width*(right?.25:.75),y=box.y+box.height/2;
 await page.mouse.move(start,y);await page.mouse.down({button:'middle'});await page.mouse.move(end,y,{steps:10});await page.mouse.up({button:'middle'});
}
export async function centerCanvasHorizontally(page,worldX){
 await dismissCanvasPanels(page);
 const rect=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),width:+e.getAttribute('width')}));
 const delta=(v.x+v.width/2-worldX)/v.width*rect.width;
 if(Math.abs(delta)>rect.width*.45)throw Error('Requested test camera move must fit one bounded mouse gesture');
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down({button:'middle'});
 await page.mouse.move(rect.x+rect.width/2+delta,rect.y+rect.height/2,{steps:10});await page.mouse.up({button:'middle'});
}
export async function scenePixels(page){
 await page.evaluate(()=>document.body.dataset.renderCapture='true');
 try{return await page.locator('canvas').screenshot();}finally{await page.evaluate(()=>delete document.body.dataset.renderCapture);}
}
