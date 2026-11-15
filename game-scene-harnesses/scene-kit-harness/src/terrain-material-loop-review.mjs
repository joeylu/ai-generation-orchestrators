import {inspectPng} from './png.mjs';
import {check,hash,seal} from './generation/common.mjs';
import {validateTerrainMaterialLoop} from './terrain-material-loop.mjs';

const q=n=>Math.round(n*1e6)/1e6;
const ratio=r=>r.numerator/r.denominator;
const accumulator=()=>({samples:0,total:0,native:0,excess:0,maximum:0,maximumExcess:0,worst:[]});
const order=(a,b)=>b.excess-a.excess||b.contrast-a.contrast||a.row-b.row||a.column-b.column;
function add(stats,value){
  stats.samples++;stats.total+=value.contrast;stats.native+=value.nativeGradient;stats.excess+=value.excess;
  stats.maximum=Math.max(stats.maximum,value.contrast);stats.maximumExcess=Math.max(stats.maximumExcess,value.excess);
  if(stats.worst.length<8||order(value,stats.worst.at(-1))<0){stats.worst.push(value);stats.worst.sort(order);stats.worst.length=Math.min(8,stats.worst.length);}
}
function summary(stats){
  const mean=n=>stats.samples?q(n/stats.samples):0;
  return {samples:stats.samples,mean:mean(stats.total),maximum:q(stats.maximum),meanNativeGradient:mean(stats.native),
    meanExcess:mean(stats.excess),maximumExcess:q(stats.maximumExcess),worst:stats.worst.map(r=>({...r,
      contrast:q(r.contrast),nativeGradient:q(r.nativeGradient),excess:q(r.excess)}))};
}

// Review the actual source-pixel provenance, including internal cut branches and
// source X wraps moved inside a phase. A quiet output wrap is not a quiet stitch.
// This is read-only evidence, never an optimizer, new acceptance gate or art score.
export function reviewTerrainMaterialLoop(record,{appearance,readAsset}={}){
  validateTerrainMaterialLoop(record,{appearance,readAsset});
  const source=inspectPng(Buffer.from(readAsset(record.sourceInput.path)),{includePixels:true}),
    output=inspectPng(Buffer.from(readAsset(record.output.source.path)),{includePixels:true}),
    W=source.width,H=output.height,P=record.options.usableRows-record.options.overlapRows,
    provenance=new Uint32Array(W*H),bytes=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const phase=record.phases[Math.floor(y/P)],row=y%P,tail=row<phase.cutRows[x],
      sy=tail?row+P:row,sx=(x+(tail?phase.previousXOffsetPixels:phase.xOffsetPixels))%W,index=y*W+x;
    provenance[index]=sy*W+sx;bytes.writeUInt32LE(provenance[index],index*4);
  }
  check(hash(bytes)===record.provenanceSha256,'MATERIAL_LOOP_REVIEW_PROVENANCE');
  const difference=(a,b)=>{
    let n=0;for(let c=0;c<3;c++)n+=Math.abs(source.rgba[a*4+c]-source.rgba[b*4+c]);return n/3;
  },gradient=(p,axis)=>{
    const x=p%W,y=Math.floor(p/W),step=axis==='horizontal'?1:W,
      before=axis==='horizontal'?x>0:y>0,after=axis==='horizontal'?x<W-1:y<source.height-1;
    return Math.max(before?difference(p-step,p):0,after?difference(p,p+step):0);
  },jumps={horizontal:accumulator(),vertical:accumulator()},wraps={horizontal:accumulator(),vertical:accumulator()},
    sourceWraps=accumulator(),counts={nativeContiguous:0,selectedSourceJumps:0,sourceHorizontalWraps:0};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)for(const axis of ['horizontal','vertical']){
    const bx=axis==='horizontal'?(x+1)%W:x,by=axis==='vertical'?(y+1)%H:y,
      a=provenance[y*W+x],b=provenance[by*W+bx],ax=a%W,ay=Math.floor(a/W),sx=b%W,sy=Math.floor(b/W),
      contiguous=axis==='horizontal'?ay===sy&&sx===ax+1:ax===sx&&sy===ay+1,
      sourceWrap=axis==='horizontal'&&ay===sy&&ax===W-1&&sx===0,
      outputWrap=axis==='horizontal'?x===W-1:y===H-1;
    if(contiguous&&!outputWrap){counts.nativeContiguous++;continue;}
    const contrast=difference(a,b),nativeGradient=Math.max(gradient(a,axis),gradient(b,axis)),
      value={column:bx,row:by,contrast,nativeGradient,excess:Math.max(0,contrast-nativeGradient),
        beforeSource:{x:ax,y:ay},afterSource:{x:sx,y:sy}};
    if(outputWrap)add(wraps[axis],value);
    if(contiguous)counts.nativeContiguous++;
    else if(sourceWrap){counts.sourceHorizontalWraps++;add(sourceWraps,value);}
    else{counts.selectedSourceJumps++;add(jumps[axis],value);}
  }
  const period={width:ratio(record.bodyPeriod.width),height:ratio(record.bodyPeriod.height)};
  return seal({format:'ai_scene_terrain_material_loop_review_v1',loopSha256:record.sha256,
    sourceSha256:record.sourceInput.sha256,outputSha256:record.output.source.sha256,
    bodyPeriodWorld:{width:q(period.width),height:q(period.height)},phaseCount:record.phases.length,
    phaseStrideWorld:q(period.height/record.phases.length),
    sourcePixelWorld:{x:q(period.width/W),y:q(period.height/H)},
    phaseHorizontalTranslationsWorld:record.phases.map(p=>q(p.xOffsetPixels*period.width/W)),
    selectedSourceJumps:{horizontal:summary(jumps.horizontal),vertical:summary(jumps.vertical)},
    sourceHorizontalWraps:summary(sourceWraps),outputWraps:{horizontal:summary(wraps.horizontal),vertical:summary(wraps.vertical)},
    work:{outputPixels:W*H,neighborPairs:W*H*2,...counts},
    method:'all-source-provenance-neighbor-jumps-relative-to-maximum-nonwrapping-native-endpoint-gradient',
    scope:'one-complete-output-period-no-rendered-occlusion-or-semantic-rock-form-analysis',
    phaseStrideIsRepeatPeriod:false,semanticFeatureDetection:false,automaticWindowSelection:false,technicalOrArtQualification:false,
    sourceProcessing:'none',generationCalls:0,productionKit:false,artAcceptance:'not-assessed'});
}
