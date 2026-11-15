import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname,basename,delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {buildStudio,dependency,packageRoot} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit,readMap} from '../../src/kit.mjs';
import {dismissCanvasPanels} from './canvas-controls.mjs';

const roots=process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean)??[];

test('single-screen Play Mode offers a free camera without changing its author or replacing the saved editor camera',{timeout:120000},async t=>{
  const parent=resolve(tmpdir()),temporary=mkdtempSync(join(parent,'scene-play-camera-'));
  let browser,host;
  t.after(async()=>{
    await browser?.close();await host?.close();
    assert.equal(dirname(temporary),parent);assert(basename(temporary).startsWith('scene-play-camera-'));
    rmSync(temporary,{recursive:true,force:true});
  });
  const root=join(packageRoot,'tests/fixtures/synthetic'),handle=loadSceneKit(root),initialDocument=structuredClone(readMap(handle));
  // A legal one-screen map reproduces the city report without using its art.
  initialDocument.bounds={x:0,y:0,width:16,height:9};
  initialDocument.terrainRuns=[{x:0,y:8,length:16,familyId:'terrain.primary'}];
  initialDocument.assemblyInstances=[];
  const staticRoot=await buildStudio({roots,output:join(temporary,'static')});
  host=await startStudio({root,staticRoot,initialDocument});
  const {chromium}=dependency('playwright',roots).require('playwright');
  browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
  const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
  const errors=[],warnings=[],external=[],mutations=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
  page.on('request',request=>{if(request.method()!=='GET')mutations.push({method:request.method(),url:new URL(request.url()).pathname});});
  await page.route('**/*',route=>new URL(route.request().url()).origin===host.url?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  const snapshot=()=>page.evaluate(async()=>(await fetch('/api/state')).json());
  const visible=()=>page.locator('#minimap rect').last().evaluate(element=>Object.fromEntries(['x','y','width','height'].map(key=>[key,+element.getAttribute(key)])));
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const closeCamera=(actual,expected,message)=>{for(const key of ['x','y','width','height'])assert(Math.abs(actual[key]-expected[key])<1e-5,`${message}: ${key} ${actual[key]} != ${expected[key]}`);};
  async function drag(button,dx,dy=0){
    await dismissCanvasPanels(page);const box=await page.locator('canvas').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down({button});await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up({button});await settle();
  }
  async function wheel(delta){const box=await page.locator('canvas').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,delta);await settle();}
  async function shot(name){if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,name)});}}
  const before=await snapshot();
  assert.deepEqual(before.scene.worldBounds,{x:0,y:0,width:1024,height:576});
  assert.deepEqual(before.scene.defaultCamera.viewport,{width:1024,height:576});
  assert.equal(await page.locator('#preview-camera').isVisible(),false);
  await page.locator('#zoom-in').click();await drag('middle',75,35);const editorCamera=await visible();

  await page.getByRole('button',{name:'Play Mode',exact:true}).click();await settle();
  const freeCamera=page.getByRole('button',{name:'自由镜头',exact:true});
  assert.equal(await freeCamera.isVisible(),true);assert.equal(await freeCamera.getAttribute('aria-pressed'),'false');
  const gameCamera={x:0,y:0,width:1024,height:576};closeCamera(await visible(),gameCamera,'one-screen framed viewport');
  await drag('left',120,50);await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');await wheel(500);
  closeCamera(await visible(),gameCamera,'framed input preserves the one-screen game bounds');
  assert.equal(await page.locator('#zoom-in').isDisabled(),true);await shot('play-camera-framed.png');

  await freeCamera.click();await settle();
  assert.equal(await freeCamera.getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#game-frame').isChecked(),false);
  assert.equal(await page.locator('#zoom-in').isDisabled(),false);
  const freeStart=await visible();await drag('left',130,60);const freeDragged=await visible();
  assert(Math.abs(freeDragged.x-freeStart.x)>10,'free left drag moves horizontally on a single-screen map');
  assert(Math.abs(freeDragged.y-freeStart.y)>10,'free left drag moves vertically on a single-screen map');
  const beforeWheel=await visible();await wheel(-400);
  await page.waitForFunction(width=>+document.querySelector('#minimap rect:last-child').getAttribute('width')<width-1,beforeWheel.width);
  const zoomed=await visible();assert(zoomed.height<beforeWheel.height,'free wheel changes the camera scale');
  await page.keyboard.press('ArrowRight');await settle();const keyboardCamera=await visible();
  assert(Math.abs(keyboardCamera.x-zoomed.x-512)<1e-5,'free keyboard moves by half the logical game viewport');
  assert(Math.abs(keyboardCamera.y-zoomed.y)<1e-5);await shot('play-camera-free.png');

  await freeCamera.click();await settle();assert.equal(await freeCamera.getAttribute('aria-pressed'),'false');
  closeCamera(await visible(),gameCamera,'returning to game mode restores bounded fixed dimensions');
  // Exercise another free-camera transition before exiting. Saving the camera
  // at each framed/free toggle would incorrectly replace this editor snapshot.
  await freeCamera.click();await drag('left',-95,-30);await wheel(250);
  await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();await settle();
  closeCamera(await visible(),editorCamera,'exit from free preview restores the original edit position and scale');
  assert.equal(await page.locator('#preview-camera').isVisible(),false);await shot('play-camera-restored.png');
  await page.getByRole('button',{name:'Play Mode',exact:true}).click();await settle();
  assert.equal(await freeCamera.getAttribute('aria-pressed'),'false');closeCamera(await visible(),gameCamera,'a later Play Mode starts framed');
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('canvas').width===Math.round(document.querySelector('#canvas-host').clientWidth));
  assert.equal(await freeCamera.isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the game-mode header fits a narrow screen');
  await freeCamera.click();await settle();assert.equal(await freeCamera.getAttribute('aria-pressed'),'true');
  const narrowButton=await freeCamera.boundingBox();assert(narrowButton.x>=0&&narrowButton.x+narrowButton.width<=390,'the free-camera control remains on screen');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the free-mode header fits a narrow screen');
  await shot('play-camera-free-mobile.png');
  await freeCamera.click();await page.setViewportSize({width:1440,height:1050});
  await page.waitForFunction(()=>document.querySelector('canvas').width===Math.round(document.querySelector('#canvas-host').clientWidth));await settle();
  await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();await settle();
  closeCamera(await visible(),editorCamera,'exit from framed preview also restores the same editor camera');

  const after=await snapshot();assert.deepEqual(after.document,before.document);assert.deepEqual(after.history,before.history);
  assert.equal(after.revision,before.revision);assert.equal(after.scene.source.authorSha256,before.scene.source.authorSha256);
  assert.equal(after.scene.contentSha256,before.scene.contentSha256);assert.deepEqual(mutations,[]);
  const renderer=await page.locator('canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2')??canvas.getContext('webgl');const debug=gl?.getExtension('WEBGL_debug_renderer_info');return debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER);});
  assert.match(renderer,/swiftshader/i);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert(warnings.every(message=>/ReadPixels|GPU stall|deprecated|powerPreference/i.test(message)),warnings.join('\n'));
});
