import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,hash,jsonBytes,seal} from './generation/common.mjs';
import {verifyCoherentDelivery} from './coherent-pipeline.mjs';
import {coherentComparison} from './coherent-render.mjs';
import {inspectPng} from './png.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
// The editing host stays deterministic. Browser dependencies are optional local tools,
// injected by the CLI; this module never discovers providers, downloads or starts media jobs.
export async function startCoherentStudio(root,delivery,{port=0,buildStudio,startStudio}={}){
  check(typeof buildStudio==='function'&&typeof startStudio==='function','COHERENT_STUDIO_TOOLS');verifyCoherentDelivery(root,delivery);
  const staticRoot=await buildStudio(),initialDocument=parseJson(readSelectedFile(join(delivery,'export/scene.document.json')));
  return startStudio({root:join(delivery,'candidate/kit'),staticRoot,port,initialDocument});
}
export async function captureCoherentStudio(root,delivery,output,{chromium,buildStudio,startStudio,channel}={}){
  check(chromium&&typeof chromium.launch==='function','COHERENT_BROWSER_REQUIRED');
  const report=parseJson(readSelectedFile(join(delivery,'delivery.json'))),out=makeFreshDirectory(output,sourceRoot);
  const host=await startCoherentStudio(root,delivery,{buildStudio,startStudio});let browser;
  const errors=[],warnings=[],external=[];
  try{
    browser=await chromium.launch({headless:true,...(channel?{channel}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader', '--explicitly-allowed-ports='+new URL(host.url).port]});
    const page=await browser.newPage({viewport:{width:1680,height:1060},deviceScaleFactor:1,acceptDownloads:true});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==host.url){external.push('blocked-external-origin');return route.abort();}return route.continue();});
    await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
    check((await page.title()).includes('Scene Kit Studio'),'COHERENT_BROWSER_IDENTITY');
    const initial=await page.evaluate(async()=>await(await fetch('/api/state')).json());check(initial.scene.source.authorSha256===report.authorSha256,'COHERENT_BROWSER_SOURCE');
    await page.locator('#grid').uncheck();await page.locator('#home').click();await page.screenshot({path:join(out,'studio-editor.png')});
    const before=initial.scene.source.authorSha256;
    const layerCheck=page.locator('#layers input').first();await layerCheck.uncheck();
    check((await page.evaluate(async()=>await(await fetch('/api/state')).json())).scene.source.authorSha256===before,'COHERENT_BROWSER_EDITOR_STATE');await layerCheck.check();
    await page.locator('#preview').click();
    await page.screenshot({path:join(out,'studio-preview.png')});
    const rect=await page.locator('canvas').boundingBox(),frame=initial.scene.defaultCamera.viewport,s=Math.min(rect.width/frame.width,rect.height/frame.height);
    const caption=await page.locator('.canvas-caption').elementHandle();await caption.evaluate(e=>e.remove());
    let pixels;try{pixels=await page.screenshot({clip:{x:rect.x+(rect.width-frame.width*s)/2,y:rect.y+(rect.height-frame.height*s)/2,width:frame.width*s,height:frame.height*s}});}
    finally{await page.locator('#canvas-shell').evaluate((shell,element)=>shell.append(element),caption);await caption.dispose();}
    const capturedImage=inspectPng(pixels,{pixelStats:true,allowHiddenRgb:true});
    check(capturedImage.width>0&&capturedImage.height>0&&capturedImage.varied&&capturedImage.nonzeroAlphaPixels>0,'COHERENT_BROWSER_BLANK');
    writeFreshFile(join(out,'studio-scene.png'),pixels,sourceRoot);
    const reference=readSelectedFile(join(delivery,'reference-native.png'),16777216),comparison=coherentComparison(reference,pixels);
    writeFreshFile(join(out,'reference-vs-studio.png'),comparison,sourceRoot);
    await page.locator('#download-menu>summary').click();
    const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.locator('#save').click()]);await download.saveAs(join(out,'browser-scene.document.json'));
    const doc=parseJson(readSelectedFile(join(out,'browser-scene.document.json')));check(JSON.stringify(doc)===JSON.stringify(initial.document),'COHERENT_BROWSER_SAVE');
    await page.locator('#download-menu>summary').click();
    const [zip]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.locator('#export-pack').click()]);await zip.saveAs(join(out,'browser-scene-kit.zip'));
    const bytes=readSelectedFile(join(out,'browser-scene-kit.zip'),268435456);check(hash(bytes)===report.zip.sha256,'COHERENT_BROWSER_ZIP');
    check(errors.length===0&&warnings.length===0&&external.length===0,'COHERENT_BROWSER_ERRORS');
    const proof=seal({format:'ai_scene_coherent_studio_capture_v1',deliverySha256:report.sha256,authorSha256:before,
      identity:true,nonblank:true,actualStudioFrame:true,editorVisibilityDoesNotChangeMap:true,browserSaveVerified:true,browserZipEqualsCli:true,
      errors:[],warnings:[],externalRequests:[],artAcceptance:'not-assessed',generationCalls:0,
      artifacts:['studio-editor.png','studio-preview.png','studio-scene.png','reference-vs-studio.png'].map(path=>{const b=readSelectedFile(join(out,path),16777216);return {path,sha256:hash(b),byteLength:b.length};})});
    writeFreshFile(join(out,'capture.json'),jsonBytes(proof),sourceRoot);return proof;
  }catch(error){writeFreshFile(join(out,'capture-failed.json'),jsonBytes(seal({format:'ai_scene_coherent_studio_capture_failure_v1',failureCode:error.errors?.[0]?.code??'BROWSER_RUNTIME_FAILURE',errors,warnings,externalRequests:external,
    deliverySha256:report.sha256,outcome:'failed-no-acceptance',generationCalls:0})),sourceRoot);check(false,'COHERENT_CAPTURE_FAILED');}
  finally{await Promise.allSettled([browser?.close(),host.close()]);}
}
