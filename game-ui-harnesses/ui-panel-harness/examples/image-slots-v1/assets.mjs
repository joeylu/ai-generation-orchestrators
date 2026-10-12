/** Explicit deterministic PNG envelopes for resource/fit acceptance, not portrait artwork. */
import {png} from '../../src/raster-skin.mjs';
import {digestBytes,digestJson} from '../../src/canonical.mjs';
import {createWorkbenchAssetPool} from '../../src/workbench-assets.mjs';
export async function imageAssetPool(){
  const records=[],resources=[],names=['战士','魔法师','弓箭手'];
  for(let i=0;i<3;i++){
    const width=128,height=192,bytes=png(width,height,[['#DDEBE6','#E6E2EE','#ECE5D8'][i],['#597F70','#78658E','#92774F'][i]],(x,y)=>x<8||y<8||x>=width-8||y>=height-8?8:(x-64)**2+(y-72)**2<30**2||y>116&&y<160&&x>28&&x<100?8:4);
    const sha256=await digestBytes(bytes),path=`textures/${sha256}.png`,id='image'+i;
    const metadata={id,version:'1.0.0',name:names[i]+'肖像绑定验证纹理',role:'shape',tags:[names[i],'角色','肖像','验证纹理'],size:{width,height},family:'image-fixture',style:'fixture',variant:'default',slice:null};
    const body={key:`image-fixtures/${id}@1.0.0`,namespace:'image-fixtures',metadata,
      source:{format:'png',file:{path:`sources/${sha256}.png`,sha256,bytes:bytes.length}},file:{path,sha256,bytes:bytes.length},
      image:{width,height,channels:4,alpha:{mode:'opaque',opaquePixels:width*height,softPixels:0,transparentPixels:0,hiddenRgbPixels:0,visibleBounds:{x:0,y:0,width,height}}}};
    const revision=await digestJson(body);records.push({...body,revision,preview:{path:`previews/${revision}.png`,sha256,bytes:bytes.length}});resources.push({path,mime:'image/png',bytes});
  }
  const payload={assetLibraryVersion:'0.1',id:'image-fixtures',parent:null,renderer:{name:'deterministic-indexed-png-fixture',version:'1'},records,
    summary:{versions:3,assets:3,pngFiles:3,sourceFiles:3,roles:{icon:0,shape:3,effect:0,'layout-primitive':0,'animation-part':0}},changes:{added:records.map(record=>record.key),reused:[],retained:[]},
    verification:{files:'HASHED',images:'DECODED_NONEMPTY_ALPHA_CLEAN',semanticReview:'NOT_RUN',visualReview:'NOT_RUN',nativeEngines:'NOT_RUN'}};
  return createWorkbenchAssetPool({...payload,sha256:await digestJson(payload)},resources);
}
