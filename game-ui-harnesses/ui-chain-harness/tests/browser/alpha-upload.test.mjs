import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {encodePng,decodePng} from '../../src/skins/png.mjs';

test('ImageBitmap upload matches browser PNG compositing for faint saturated edges',async()=>{
  const pixels=Buffer.alloc(16*16*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=255;pixels[i+1]=40;pixels[i+2]=12;pixels[i+3]=(i/4)%16<8?8:128;}
  const png=encodePng({width:16,height:16,pixels});
  const bundled=await build({stdin:{contents:`import {Application,Sprite} from 'pixi.js';import {loadSliceAsset} from './src/slicing/asset.mjs';window.renderTest=async(data,bg)=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const owner=await loadSliceAsset(bytes);const app=new Application();await app.init({width:16,height:16,resolution:1,background:bg,preference:'webgl'});app.canvas.id='actual';document.body.replaceChildren(app.canvas);app.stage.addChild(new Sprite({texture:owner.texture(1)}));app.render();const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const c=document.createElement('canvas');c.id='expected';c.width=c.height=16;const x=c.getContext('2d');x.fillStyle=bg;x.fillRect(0,0,16,16);x.drawImage(img,0,0);document.body.append(c);window.cleanup=()=>{app.destroy(true,{children:true});owner.dispose();};};`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({channel:process.env.UI_CHAIN_TEST_BROWSER??'chrome',headless:true});
  try{const page=await browser.newPage();await page.route('**/*',r=>r.request().url()==='http://127.0.0.1/alpha-test'?r.fulfill({contentType:'text/html',body:'<body></body>'}):r.abort());await page.goto('http://127.0.0.1/alpha-test');await page.addScriptTag({content:bundled.outputFiles[0].text});
    for(const bg of ['#101c2b','#f4eddd']){
      await page.evaluate(async({png,bg})=>window.renderTest(png,bg),{png:png.toString('base64'),bg});
      const actual=decodePng(await page.locator('#actual').screenshot()),expected=decodePng(await page.locator('#expected').screenshot());
      let max=0;for(let i=0;i<actual.pixels.length;i++)max=Math.max(max,Math.abs(actual.pixels[i]-expected.pixels[i]));
      assert.ok(max<=2,`compositing error ${max} on ${bg}`);await page.evaluate(()=>window.cleanup());
    }
  }finally{await browser.close();}
});
