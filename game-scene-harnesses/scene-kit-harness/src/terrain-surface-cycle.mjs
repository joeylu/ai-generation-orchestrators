import {inspectPng,encodeRgbaPng} from './png.mjs';
import {canonicalJson} from './document.mjs';
import {buildTerrainMaterialLoop} from './terrain-material-loop.mjs';
import {check,exact,hash,seal,unseal} from './generation/common.mjs';

export const TERRAIN_SURFACE_CYCLE_PROFILE='source-pixel-horizontal-cap-cycle-v1';
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const pathSafe=p=>typeof p==='string'&&p.length<=240&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.png$/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
function sourceRef(source){
  exact(source,['path','sha256','byteLength']);
  check(pathSafe(source.path)&&/^[a-f0-9]{64}$/.test(source.sha256)&&integer(source.byteLength,1,16777216),'SURFACE_CYCLE_SOURCE');
}

// Pure source-preserving derivation; delivery owns explicit kit integration.
// Transposition only reuses the closed-overlap solver; native rows never move.
export function buildTerrainSurfaceCycle(input,options){
  exact(options,['source','outputPath','fromColumn','usableColumns','overlapColumns']);
  const {source,outputPath,fromColumn,usableColumns,overlapColumns}=options;sourceRef(source);
  check(input instanceof Uint8Array&&input.byteLength===source.byteLength&&hash(input)===source.sha256,'SURFACE_CYCLE_SOURCE');
  check(pathSafe(outputPath)&&outputPath!==source.path,'SURFACE_CYCLE_OUTPUT');
  const image=inspectPng(Buffer.from(input),{includePixels:true}),W=image.width,H=image.height;
  check(integer(W,64,2048)&&integer(H,32,2048)&&W*H<=4194304&&image.transparentPixels===0,'SURFACE_CYCLE_IMAGE');
  check(integer(fromColumn,0,W-64)&&integer(usableColumns,64,W-fromColumn)
    &&integer(overlapColumns,16,Math.min(256,Math.floor((usableColumns-1)/2))),'SURFACE_CYCLE_WINDOW');
  const period=usableColumns-overlapColumns;
  check(period>=32&&W%period===0&&W/period<=32,'SURFACE_CYCLE_PERIOD');
  const transposed=Buffer.alloc(H*usableColumns*4);
  for(let x=0;x<usableColumns;x++)for(let y=0;y<H;y++){
    const s=(y*W+fromColumn+x)*4;image.rgba.copy(transposed,(x*H+y)*4,s,s+4);
  }
  const seed=encodeRgbaPng(H,usableColumns,transposed),seedSource={path:'evidence/cap-cycle-transposed-seed.png',sha256:hash(seed),byteLength:seed.length};
  const closed=buildTerrainMaterialLoop(seed,{source:seedSource,outputPath:'evidence/cap-cycle-closed-seed.png',usableRows:usableColumns,overlapRows:overlapColumns,phaseCount:1});
  const selected=inspectPng(closed.png,{includePixels:true}),cuts=closed.record.phases[0].cutRows;
  check(selected.width===H&&selected.height===period,'SURFACE_CYCLE_SHAPE');
  const rgba=Buffer.alloc(W*H*4),provenance=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const r=x%period,sx=fromColumn+r+(r<cuts[y]?period:0),s=(y*W+sx)*4,t=(y*W+x)*4,closedOffset=(r*H+y)*4;
    check(selected.rgba.subarray(closedOffset,closedOffset+4).equals(image.rgba.subarray(s,s+4)),'SURFACE_CYCLE_ROW_IDENTITY');
    image.rgba.copy(rgba,t,s,s+4);provenance.writeUInt32LE(y*W+sx,t);
  }
  const png=encodeRgbaPng(W,H,rgba);
  check(png.length<=16777216,'SURFACE_CYCLE_OUTPUT');
  const record=seal({format:'ai_scene_terrain_surface_cycle_v1',profile:TERRAIN_SURFACE_CYCLE_PROFILE,
    sourceInput:{...source,pixelSize:{width:W,height:H},rgbaSha256:hash(image.rgba)},options:{fromColumn,usableColumns,overlapColumns},
    closure:closed.record,output:{source:{path:outputPath,sha256:hash(png),byteLength:png.length},pixelSize:{width:W,height:H}},
    periodColumns:period,repeatCount:W/period,provenanceSha256:hash(provenance),
    sampling:'unchanged-native-rows-and-column-density-in-the-original-output-frame',sourcePixelSelectionOnly:true,
    sourcePngModified:false,pixelsRecolored:false,nativeRowsMoved:false,sourceCoordinatesWarped:false,
    generationCalls:0,productionKit:false,artAcceptance:'not-assessed'});
  return {record,png};
}

export function validateTerrainSurfaceCycle(record,{readAsset}={}){
  unseal(record);exact(record,['format','profile','sourceInput','options','closure','output','periodColumns','repeatCount','provenanceSha256','sampling',
    'sourcePixelSelectionOnly','sourcePngModified','pixelsRecolored','nativeRowsMoved','sourceCoordinatesWarped','generationCalls','productionKit','artAcceptance','sha256']);
  check(record.format==='ai_scene_terrain_surface_cycle_v1'&&record.profile===TERRAIN_SURFACE_CYCLE_PROFILE&&typeof readAsset==='function','SURFACE_CYCLE_PROFILE');
  exact(record.sourceInput,['path','sha256','byteLength','pixelSize','rgbaSha256']);
  exact(record.output,['source','pixelSize']);sourceRef(record.output.source);
  const {pixelSize,rgbaSha256,...source}=record.sourceInput;
  sourceRef(source);exact(record.options,['fromColumn','usableColumns','overlapColumns']);
  const input=readAsset(source.path);check(input instanceof Uint8Array,'SURFACE_CYCLE_SOURCE');
  const replay=buildTerrainSurfaceCycle(input,{source,outputPath:record.output.source.path,...record.options});
  check(canonicalJson(record)===canonicalJson(replay.record),'SURFACE_CYCLE_REPLAY');
  const actual=readAsset(record.output.source.path);
  check(actual instanceof Uint8Array&&Buffer.from(actual).equals(replay.png),'SURFACE_CYCLE_OUTPUT_REPLAY');
  return record;
}

// The X wrap can be a contiguous native pair while the internal stitch jumps
// between distant columns. This measures both stitch directions relative to
// original endpoint gradients. Row weighting does not model rendered occlusion.
export function reviewTerrainSurfaceCycle(record,{readAsset,display}={}){
  validateTerrainSurfaceCycle(record,{readAsset});
  exact(display,['capEndRow','fadeRows','widthWorld']);
  const W=record.output.pixelSize.width,H=record.output.pixelSize.height,P=record.periodColumns,
    {capEndRow,fadeRows,widthWorld}=display;
  check(integer(capEndRow,1,H)&&integer(fadeRows,0,capEndRow)
    &&Number.isFinite(widthWorld)&&widthWorld>0&&widthWorld<=4096,'SURFACE_CYCLE_REVIEW_DISPLAY');
  const source=inspectPng(Buffer.from(readAsset(record.sourceInput.path)),{includePixels:true}),
    cuts=record.closure.phases[0].cutRows,from=record.options.fromColumn;
  const at=(x,y,c)=>source.rgba[(y*W+x)*4+c],difference=(ax,ay,bx,by)=>{
    let total=0;for(let c=0;c<3;c++)total+=Math.abs(at(ax,ay,c)-at(bx,by,c));return total/3;
  },opacity=y=>fadeRows?Math.min(1,(capEndRow-y-.5)/fadeRows):1,
    selectedX=(x,y)=>from+x+(x<cuts[y]?P:0),horizontal=[],vertical=[];
  for(let y=0;y<capEndRow;y++){
    const x=cuts[y],a=from+x+P-1,b=from+x;
    horizontal.push({x,y,contrast:difference(a,y,b,y),nativeGradient:Math.max(difference(a,y,a+1,y),difference(b-1,y,b,y)),opacity:opacity(y)});
    if(y)for(let x=Math.min(cuts[y],cuts[y-1]);x<Math.max(cuts[y],cuts[y-1]);x++){
      const a=selectedX(x,y-1),b=selectedX(x,y);
      vertical.push({x,y,contrast:difference(a,y-1,b,y),nativeGradient:Math.max(difference(a,y-1,a,y),difference(b,y-1,b,y)),opacity:opacity(y)});
    }
  }
  const q=n=>Math.round(n*1e6)/1e6;
  function summarize(rows){
    if(!rows.length)return {samples:0,mean:0,maximum:0,weightedMean:0,weightedMaximum:0,meanNativeGradient:0,meanExcess:0,maximumExcess:0,weightedMeanExcess:0,worst:[]};
    const excess=r=>Math.max(0,r.contrast-r.nativeGradient),mean=f=>q(rows.reduce((n,r)=>n+f(r),0)/rows.length),max=f=>q(Math.max(...rows.map(f)));
    return {samples:rows.length,mean:mean(r=>r.contrast),maximum:max(r=>r.contrast),weightedMean:mean(r=>r.contrast*r.opacity),
      weightedMaximum:max(r=>r.contrast*r.opacity),meanNativeGradient:mean(r=>r.nativeGradient),meanExcess:mean(excess),maximumExcess:max(excess),
      weightedMeanExcess:mean(r=>excess(r)*r.opacity),worst:[...rows].sort((a,b)=>excess(b)*b.opacity-excess(a)*a.opacity||a.y-b.y||a.x-b.x).slice(0,8)
        .map(r=>({column:r.x,row:r.y,contrast:q(r.contrast),nativeGradient:q(r.nativeGradient),excess:q(excess(r)),displayOpacity:q(r.opacity)}))};
  }
  return seal({format:'ai_scene_terrain_surface_cycle_review_v1',cycleSha256:record.sha256,sourceSha256:record.sourceInput.sha256,
    outputSha256:record.output.source.sha256,display:{...display},periodColumns:P,repeatCount:record.repeatCount,subperiodWorld:q(widthWorld*P/W),
    horizontalStitches:summarize(horizontal),verticalBranchStitches:summarize(vertical),
    method:'internal-selected-column-stitches-relative-to-original-endpoint-gradients-one-period',
    weighting:'linear-native-row-center-display-approximation-not-rendered-occlusion',
    semanticCoverDetection:false,automaticWindowSelection:false,technicalOrArtQualification:false,
    generationCalls:0,productionKit:false,artAcceptance:'not-assessed'});
}
