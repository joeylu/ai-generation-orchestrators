import {dependency,packageRoot} from '../../scripts/studio-build.mjs';
import {check,hash} from '../../src/generation/common.mjs';

// Private offline test/evidence surface: no server, paths or remote resources.
// Production Pixi code owns all terrain meshes, samplers and drawing order.
export async function diagnosticViewerBundle(){
  const {build}=dependency('esbuild').require('esbuild'),pixi=dependency('pixi.js');
  const result=await build({stdin:{resolveDir:packageRoot,sourcefile:'diagnostic-viewer.mjs',contents:`
    import {Application,Assets,Graphics,Mesh} from 'pixi.js';
    import {createSceneView,loadTerrainMaterial} from './src/pixi/scene-view.mjs';
    const app=new Application();let view;
    await app.init({width:32,height:32,background:'#1d2b3b',preference:'webgl',antialias:false,resolution:1});
    document.body.style.margin='0';document.body.append(app.canvas);const backdrop=new Graphics();app.stage.addChild(backdrop);
    window.drawTerrainDiagnostic=async({scene,assets,camera})=>{
      if(view){app.stage.removeChild(view.root);view.destroy();}
      app.renderer.resize(camera.width,camera.height);
      backdrop.clear();backdrop.visible=!!camera.alphaMask;
      if(camera.alphaMask)backdrop.rect(0,0,camera.width,camera.height).fill(0xffffff);
      const material=await loadTerrainMaterial(scene.terrainMaterial,item=>Assets.load(assets[item.source.path]));
      view=createSceneView({resolveTexture:()=>{throw Error('Diagnostic sprites must be omitted');},resolveCurveMaterial:()=>material});
      view.update(scene);view.setCamera({center:camera.center,visible:{x:camera.center.x-camera.width/camera.scale/2,y:camera.center.y-camera.height/camera.scale/2,width:camera.width/camera.scale,height:camera.height/camera.scale}});
      if(camera.alphaMask){const neutral=node=>{if(node instanceof Mesh)node.tint=0;for(const child of node.children??[])neutral(child);};neutral(view.root);}
      view.root.scale.set(camera.scale);view.root.position.set(camera.width/2-camera.center.x*camera.scale,camera.height/2-camera.center.y*camera.scale);
      app.stage.addChild(view.root);app.render();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return {format:scene.format,contentSha256:scene.contentSha256??null,mode:camera.alphaMask?'native-alpha-black-on-white-display-only':'original-source-colors'};
    };`},bundle:true,format:'esm',platform:'browser',target:'es2022',alias:{'pixi.js':pixi.entry},write:false,logLevel:'silent'});
  return result.outputFiles[0].text;
}

export async function openDiagnosticViewer(page){
  await page.goto('about:blank');await page.addScriptTag({type:'module',content:await diagnosticViewerBundle()});
  await page.waitForFunction(()=>typeof window.drawTerrainDiagnostic==='function');
}

export async function drawDiagnostic(page,scene,files,camera){
  const material=scene.terrainMaterial,sources=[material.body.source,material.cap.source];
  if(material.edges)for(const side of ['left','right'])for(const part of ['wall','corner'])sources.push(material.edges[side][part].source);
  if(material.bottomEdges)for(const part of ['edge','leftCorner','rightCorner'])sources.push(material.bottomEdges[part].source);
  const assets=Object.fromEntries(sources.map(source=>{const bytes=files.get(source.path);
    check(bytes&&hash(bytes)===source.sha256&&bytes.length===source.byteLength,'DIAGNOSTIC_TEXTURE_IDENTITY');
    return [source.path,'data:image/png;base64,'+Buffer.from(bytes).toString('base64')];}));
  const result=await page.evaluate(payload=>window.drawTerrainDiagnostic(payload),{scene,assets,camera});
  return {result,png:await page.locator('canvas').screenshot()};
}
