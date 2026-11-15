import {inspectPng,encodeRgbaPng} from './png.mjs';
import {canonicalJson,deepFreeze} from './document.mjs';
import {check,exact,hash,seal,unseal} from './generation/common.mjs';

export const TERRAIN_MATERIAL_LOOP_PROFILE='source-pixel-closed-overlap-cycle-v1';
export const TERRAIN_MATERIAL_LOOP_LIMITS=deepFreeze({maximumSourceDimension:2048,maximumOverlapRows:256,
  maximumPhases:3,maximumStartCandidates:32,maximumStep:2,overlapMargin:4,
  maximumDpTransitions:268435456,maximumOutputPixels:8388608,maximumOutputHeight:4096,maximumPngBytes:16777216});
const ALGORITHM=deepFreeze({cost:'actual-cut-RGB-L1-plus-quarter-pair-L1-plus-0.35-signed-gradient-L1-plus-0.035-luma-plus-2-step-L1',
  closedEndpoints:true,maxStep:2,maximumStartCandidates:32,sourcePixelSelectionOnly:true,approximateOptimizer:true,
  selection:'previous-tail-above-cut-current-head-below-cut',integerTranslationsOnly:true});
const pathSafe=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.png$/.test(value)
  &&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const gcd=(a,b)=>b?gcd(b,a%b):a;
const rational=(numerator,denominator)=>{const g=gcd(numerator,denominator);return {numerator:numerator/g,denominator:denominator/g};};
const q=value=>Math.round(value*1e6)/1e6;
function stats(values){let sum=0,maximum=0,minimum=Infinity;for(const v of values){sum+=v;maximum=Math.max(maximum,v);minimum=Math.min(minimum,v);}return {mean:q(sum/values.length),minimum:q(minimum),maximum:q(maximum)};}
const sourceShape=source=>{exact(source,['path','sha256','byteLength']);check(pathSafe(source.path)&&digest(source.sha256)
  &&integer(source.byteLength,1,TERRAIN_MATERIAL_LOOP_LIMITS.maximumPngBytes),'MATERIAL_LOOP_SOURCE');};

// Score broad horizontal transitions inside the field as well as its wrap.
// A short artificial collar can score zero at the exact wrap and still stripe.
export function measureTerrainBodyBands(png){
  const {width,height,rgba}=inspectPng(Buffer.from(png),{includePixels:true});
  check(height>=4,'MATERIAL_LOOP_BAND_IMAGE');
  const rows=Array.from({length:height},(_,y)=>{
    const before=(y+height-1)%height;
    let difference=0;
    for(let x=0;x<width;x++)for(let c=0;c<3;c++)difference+=Math.abs(rgba[(y*width+x)*4+c]-rgba[(before*width+x)*4+c]);
    return difference/(width*3);
  });
  let worstStartRow=0,maximumFourRowMean=0;
  for(let i=0;i<height;i++){
    const mean=(rows[i]+rows[(i+1)%height]+rows[(i+2)%height]+rows[(i+3)%height])/4;
    if(mean>maximumFourRowMean){worstStartRow=i;maximumFourRowMean=mean;}
  }
  return {wrapNeighborMean:q(rows[0]),maximumFourRowMean:q(maximumFourRowMean),worstStartRow};
}

// Source RGB/alpha are selected verbatim. The seam may translate one source
// strip horizontally, but never scales, rotates, mirrors, blurs or blends it.
export function buildTerrainMaterialLoop(inputPNG,options){
  exact(options,['source','outputPath','usableRows','overlapRows','phaseCount']);
  const {source,outputPath,usableRows,overlapRows,phaseCount}=options,L=TERRAIN_MATERIAL_LOOP_LIMITS;sourceShape(source);
  check(pathSafe(outputPath)&&outputPath!==source.path,'MATERIAL_LOOP_OUTPUT_PATH');
  check(inputPNG instanceof Uint8Array&&inputPNG.byteLength===source.byteLength&&hash(inputPNG)===source.sha256,'MATERIAL_LOOP_SOURCE');
  const image=inspectPng(Buffer.from(inputPNG),{includePixels:true,pixelStats:true});
  check(integer(image.width,32,L.maximumSourceDimension)&&integer(image.height,64,L.maximumSourceDimension)
    &&image.transparentPixels===0&&image.varied,'MATERIAL_LOOP_SOURCE_IMAGE');
  check(integer(usableRows,64,image.height)&&integer(overlapRows,16,Math.min(L.maximumOverlapRows,Math.floor((usableRows-1)/2)))
    &&[1,3].includes(phaseCount),'MATERIAL_LOOP_OPTIONS');
  const W=image.width,P=usableRows-overlapRows,H=P*phaseCount,O=overlapRows,margin=L.overlapMargin;
  check(H<=L.maximumOutputHeight&&W*H<=L.maximumOutputPixels,'MATERIAL_LOOP_BUDGET');
  const starts=[...new Set(Array.from({length:Math.min(L.maximumStartCandidates,O-margin*2)},(_,i)=>
    Math.round(margin+i*(O-1-margin*2)/(Math.min(L.maximumStartCandidates,O-margin*2)-1))))];
  check((W-1)*(O-margin*2)*starts.length*(L.maximumStep*2+1)*phaseCount<=L.maximumDpTransitions,'MATERIAL_LOOP_BUDGET');
  const at=(shift,x,y,c)=>image.rgba[(y*W+((x+shift+W)%W))*4+c],phases=[];
  let dpTransitions=0;
  for(let phase=0;phase<phaseCount;phase++){
    const shift=Math.floor(phase*W/phaseCount),previousShift=Math.floor(((phase+phaseCount-1)%phaseCount)*W/phaseCount),costs=new Float64Array(W*O);
    for(let x=0;x<W;x++)for(let y=0;y<O;y++){
      let cut=0,pair=0,gradient=0,luma=0;
      for(let c=0;c<3;c++){
        const a=at(shift,x,y,c),b=at(previousShift,x,y+P,c),before=at(previousShift,x,y+P-1,c);
        cut+=Math.abs(a-before);pair+=Math.abs(a-b);luma+=a+b;
        const ay=at(shift,x,Math.min(O-1,y+1),c)-at(shift,x,Math.max(0,y-1),c),
          by=at(previousShift,x,P+Math.min(O-1,y+1),c)-at(previousShift,x,P+Math.max(0,y-1),c),
          ax=at(shift,x+1,y,c)-at(shift,x-1,y,c),bx=at(previousShift,x+1,y+P,c)-at(previousShift,x-1,y+P,c);
        gradient+=Math.abs(ay-by)+Math.abs(ax-bx);
      }costs[x*O+y]=cut+.25*pair+.35*gradient+.035*luma;
    }
    let best=Infinity,selected;
    for(const start of starts){
      let prior=new Float64Array(O).fill(Infinity);prior[start]=costs[start];const parents=new Int16Array(W*O).fill(-1);
      for(let x=1;x<W;x++){
        const next=new Float64Array(O).fill(Infinity);
        for(let y=margin;y<O-margin;y++){
          let value=Infinity,parent=-1;
          for(let dy=-L.maximumStep;dy<=L.maximumStep;dy++){
            const py=y+dy;if(py<margin||py>=O-margin)continue;dpTransitions++;
            const candidate=prior[py]+Math.abs(dy)*2;if(candidate<value){value=candidate;parent=py;}
          }next[y]=value+costs[x*O+y];parents[x*O+y]=parent;
        }prior=next;
      }
      // Exact closure prevents a new binary branch mismatch at the X wrap.
      if(prior[start]>=best)continue;best=prior[start];selected=new Int16Array(W);selected[W-1]=start;
      for(let x=W-1;x>0;x--)selected[x-1]=parents[x*O+selected[x]];
    }
    check(selected&&selected[0]===selected[W-1],'MATERIAL_LOOP_CLOSED_PATH');
    const actual=[];
    for(let x=0;x<W;x++){
      const y=selected[x];let difference=0;for(let c=0;c<3;c++)difference+=Math.abs(at(shift,x,y,c)-at(previousShift,x,y+P-1,c));
      actual.push(difference/3);
      if(x)check(Math.abs(y-selected[x-1])<=L.maximumStep,'MATERIAL_LOOP_CLOSED_PATH');
    }
    phases.push({phase,xOffsetPixels:shift,previousXOffsetPixels:previousShift,cutRows:[...selected],
      cutCosts:{pathMean:q(best/W),actualVerticalNeighborRgb:stats(actual),cutRange:stats([...selected])}});
  }
  check(dpTransitions<=L.maximumDpTransitions,'MATERIAL_LOOP_BUDGET');
  const rgba=Buffer.alloc(W*H*4),provenance=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const phase=Math.floor(y/P),row=y%P,item=phases[phase],tail=row<item.cutRows[x],sy=tail?row+P:row,
      sx=(x+(tail?item.previousXOffsetPixels:item.xOffsetPixels))%W,sourceIndex=sy*W+sx,target=y*W+x;
    rgba.set(image.rgba.subarray(sourceIndex*4,sourceIndex*4+4),target*4);provenance.writeUInt32LE(sourceIndex,target*4);
  }
  const png=encodeRgbaPng(W,H,rgba);check(png.length<=L.maximumPngBytes,'MATERIAL_LOOP_BUDGET');
  const record=seal({format:'ai_scene_terrain_material_loop_v1',profile:TERRAIN_MATERIAL_LOOP_PROFILE,
    sourceInput:{...source,pixelSize:{width:W,height:image.height}},options:{usableRows,overlapRows,phaseCount},algorithm:ALGORITHM,
    output:{source:{path:outputPath,sha256:hash(png),byteLength:png.length},pixelSize:{width:W,height:H}},
    bodyPeriod:{width:rational(512,1),height:rational(H*256,image.height)},sourceDensity:{normalizationHeight:image.height,worldWidth:512,worldHeight:256},
    phases,provenanceSha256:hash(provenance),work:{dpTransitions,outputPixels:W*H},limits:L,
    sourcePngChanged:false,pixelsRecolored:false,sourceCoordinatesWarped:false,sourcePixelSelectionOnly:true,
    generationCalls:0,visualAcceptance:'not-assessed'});
  return {record,png};
}

export function validateTerrainMaterialLoop(record,{appearance,readAsset}={}){
  unseal(record);
  exact(record,['format','profile','sourceInput','options','algorithm','output','bodyPeriod','sourceDensity','phases','provenanceSha256','work','limits',
    'sourcePngChanged','pixelsRecolored','sourceCoordinatesWarped','sourcePixelSelectionOnly','generationCalls','visualAcceptance','sha256']);
  check(record.format==='ai_scene_terrain_material_loop_v1'&&record.profile===TERRAIN_MATERIAL_LOOP_PROFILE&&record.sourcePngChanged===false
    &&record.pixelsRecolored===false&&record.sourceCoordinatesWarped===false&&record.sourcePixelSelectionOnly===true
    &&record.generationCalls===0&&record.visualAcceptance==='not-assessed','MATERIAL_LOOP_PROFILE');
  const source=record.sourceInput;exact(source,['path','sha256','byteLength','pixelSize']);
  const {pixelSize,...ref}=source;sourceShape(ref);
  check(['ai_scene_continuous_terrain_appearance_v5','ai_scene_continuous_terrain_appearance_v6'].includes(appearance?.format)
    &&canonicalJson(ref)===canonicalJson(appearance.body.source)
    &&canonicalJson(pixelSize)===canonicalJson(appearance.body.pixelSize),'MATERIAL_LOOP_BINDING');
  exact(record.options,['usableRows','overlapRows','phaseCount']);exact(record.output,['source','pixelSize']);sourceShape(record.output.source);
  check(typeof readAsset==='function','MATERIAL_LOOP_READ_ASSET');
  const original=readAsset(source.path);check(original instanceof Uint8Array,'MATERIAL_LOOP_SOURCE');
  const replay=buildTerrainMaterialLoop(original,{source:ref,outputPath:record.output.source.path,...record.options});
  check(canonicalJson(replay.record)===canonicalJson(record),'MATERIAL_LOOP_REPLAY');
  const actual=readAsset(record.output.source.path);
  check(actual instanceof Uint8Array&&Buffer.from(actual).equals(replay.png),'MATERIAL_LOOP_OUTPUT_REPLAY');
  return record;
}
