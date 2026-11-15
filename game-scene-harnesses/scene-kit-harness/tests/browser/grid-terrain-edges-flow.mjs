import assert from 'node:assert/strict';
import {dismissCanvasPanels} from './canvas-controls.mjs';

// Shared real pointer flow for the synthetic regression and isolated native-art
// demonstration. No direct edit/import HTTP request substitutes for a UI stroke.
export async function exerciseGridBrush(page,{hostUrl,left=18,right=25,top=3,bottom=7,extensionLeft=21,extensionRight=24,extensionTop=1,onStage=async()=>{}}={}){
  const snapshot=()=>page.evaluate(async()=>await(await fetch('/api/state')).json()),requests=[];
  page.on('request',request=>{if(request.url()===hostUrl+'/api/edit')requests.push(request.postDataJSON());});
  const revision=number=>page.waitForFunction(before=>Number(document.body.dataset.revision)>before,number,{timeout:15000});
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const screen=async(x,y)=>{
    await dismissCanvasPanels(page);const box=await page.locator('canvas').boundingBox(),visible=await page.locator('#minimap rect').last().evaluate(element=>
      ({x:Number(element.getAttribute('x')),y:Number(element.getAttribute('y')),width:Number(element.getAttribute('width')),height:Number(element.getAttribute('height'))}));
    return {x:box.x+(x-visible.x)/visible.width*box.width,y:box.y+(y-visible.y)/visible.height*box.height};
  };
  const stroke=async(x1,y1,x2=x1,y2=y1)=>{
    const before=await snapshot(),a=await screen((x1+.5)*64,(y1+.5)*64),b=await screen((x2+.5)*64,(y2+.5)*64);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:Math.max(6,3*Math.max(Math.abs(x2-x1),Math.abs(y2-y1)))});await page.mouse.up();
    await revision(before.revision);await page.waitForFunction(()=>document.querySelector('[data-tool="paint"]').disabled===false);await settle();
    assert.equal(await page.locator('#status').getAttribute('data-error'),'false');return snapshot();
  };
  const initial=await snapshot();await dismissCanvasPanels(page);
  const extend=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/edit'&&response.request().method()==='POST');
  await page.locator('#extend').click();assert.equal((await extend).status(),200);await revision(initial.revision);await dismissCanvasPanels(page);
  await page.locator('#fit').click();await page.locator('#grid').uncheck();await page.locator('#tab-terrain').click();
  await page.getByRole('button',{name:'地形画刷',exact:true}).click();
  const expanded=await snapshot();assert(expanded.document.bounds.width>initial.document.bounds.width);
  for(let y=top;y<=bottom;y++)await stroke(left,y,right,y);
  // Reframe through the actual camera gesture so native edges and joins are readable.
  const center=(left+right+1)*32,rect=await page.locator('canvas').boundingBox(),visible=await page.locator('#minimap rect').last().evaluate(element=>
    ({x:Number(element.getAttribute('x')),width:Number(element.getAttribute('width'))})),dx=(visible.x+visible.width/2-center)/visible.width*rect.width;
  assert(Math.abs(dx)<rect.width*.45);await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down({button:'middle'});
  await page.mouse.move(rect.x+rect.width/2+dx,rect.y+rect.height/2,{steps:12});await page.mouse.up({button:'middle'});
  for(let i=0;i<2;i++)await page.locator('#zoom-in').click();await settle();
  const rectangle=await snapshot();await onStage('01-rectangle',rectangle);
  for(let x=extensionLeft;x<=extensionRight;x++)await stroke(x,extensionTop,x,top-1);
  const extended=await snapshot();await onStage('02-vertical-extension',extended);
  await page.getByRole('button',{name:'擦除 E',exact:true}).click();const erased=await stroke(left,bottom-1,left,bottom);await onStage('03-erased-step',erased);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await revision(erased.revision);const undone=await snapshot();assert.deepEqual(undone.document,extended.document);
  await page.getByRole('button',{name:'重做',exact:true}).click();await revision(undone.revision);const redone=await snapshot();assert.deepEqual(redone.document,erased.document);
  await page.reload();await page.waitForSelector('body[data-ready="true"]',{timeout:90000});const reloaded=await snapshot();assert.deepEqual(reloaded.document,erased.document);
  const paintedCells=(right-left+1)*(bottom-top+1),extendedCells=(extensionRight-extensionLeft+1)*(top-extensionTop);
  assert.equal(rectangle.scene.counts.terrainNodes,expanded.scene.counts.terrainNodes+paintedCells);
  assert.equal(extended.scene.counts.terrainNodes,rectangle.scene.counts.terrainNodes+extendedCells);
  assert.equal(erased.scene.counts.terrainNodes,extended.scene.counts.terrainNodes-2);
  assert(requests.some(request=>request.commands?.some(command=>command.type==='paint-cells')));
  assert(requests.some(request=>request.commands?.some(command=>command.type==='erase-cells')));
  const pending=page.waitForEvent('download',{timeout:90000});await page.locator('#download-menu>summary').click();await page.locator('#export-pack').click();const download=await pending;
  return {initial,expanded,rectangle,extended,erased,undone,redone,reloaded,requests,download};
}
