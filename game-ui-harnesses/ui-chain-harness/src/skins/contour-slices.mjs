import {sliceSource} from '../../tools/panel-slicer/src/geometry.mjs';
import {suggestSlices} from '../../tools/panel-slicer/src/suggestion.mjs';

export function suggestMaterialSlices(image,resolution,{axis='both',filledContourFallback=false}={}){
  const strict=suggestSlices(image,resolution,{axis});
  if(strict.status!=='unsupported'||!filledContourFallback)return strict;
  const fallback=suggestContourSlices(image,resolution,{axis});
  return fallback.status==='supported'?{...fallback,strictRejection:strict.reason}:strict;
}

// Opt-in fallback for filled UI surfaces. A smooth gradient need not have a
// repeating center band. Measure the visible silhouette and retain conservative
// corner blocks; never alter pixels or claim that the material was art-approved.
export function suggestContourSlices({width,height,pixels},resolution,{axis='both'}={}){
  const reject=reason=>({status:'unsupported',reason});
  if(!['both','horizontal','vertical'].includes(axis)||!Number.isFinite(resolution)||resolution<=0||![width,height].every(n=>Number.isInteger(n)&&n>=8&&n<=4096)||!(pixels instanceof Uint8Array||pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)return reject('图片或切线参数无效。');
  const alpha=(x,y)=>pixels[(y*width+x)*4+3];
  const rows=new Uint32Array(height),cols=new Uint32Array(width);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(alpha(x,y)>=32){rows[y]++;cols[x]++;}
  const bounds=counts=>{
    const cutoff=Math.max(...counts)*.25,start=counts.findIndex(n=>n>cutoff);
    let end=counts.length-1;while(end>=start&&counts[end]<=cutoff)end--;
    return [start,end];
  };
  const [left,right]=bounds(cols),[top,bottom]=bounds(rows),w=right-left+1,h=bottom-top+1;
  if(left<0||Math.min(w,h)<24)return reject('有效填充轮廓过小。');
  let filled=0;
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(alpha(x,y)>=32)filled++;
  if(filled/(w*h)<.88)return reject('主体不是完整的填充矩形。');
  const gradients=new Uint32Array(256);let comparisons=0,opaque=0,total=0;
  const x0=left+Math.ceil(w*.2),x1=left+Math.floor(w*.8),y0=top+Math.ceil(h*.2),y1=top+Math.floor(h*.8);
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    total++;if(alpha(x,y)<224)continue;opaque++;
    const at=(y*width+x)*4;
    for(const [xx,yy]of [[x+1,y],[x,y+1]]){
      if(xx>=x1||yy>=y1||alpha(xx,yy)<224)continue;
      const next=(yy*width+xx)*4;let delta=0;
      for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(pixels[at+c]-pixels[next+c]));
      gradients[delta]++;comparisons++;
    }
  }
  if(!total||opaque/total<.98||!comparisons)return reject('内部存在明显透明区域。');
  const percentile=fraction=>{let count=0;for(let d=0;d<gradients.length;d++){count+=gradients[d];if(count>Math.floor(comparisons*fraction))return d;}};
  const p95=percentile(.95),p99=percentile(.99);
  if(p95>12||p99>48)return reject('内部存在密集高频细节，需要人工配置。');
  const short=Math.min(w,h),reach=Math.max(4,Math.ceil(short*.15));
  const corners={left:0,top:0,right:0,bottom:0};
  for(let d=0;d<reach;d++){
    for(const y of [top+d,bottom-d]){
      let a=left,b=right;while(a<=right&&alpha(a,y)<224)a++;while(b>=left&&alpha(b,y)<224)b--;
      if(b-a+1>=w*.5){corners.left=Math.max(corners.left,a-left);corners.right=Math.max(corners.right,right-b);}
    }
    for(const x of [left+d,right-d]){
      let a=top,b=bottom;while(a<=bottom&&alpha(x,a)<224)a++;while(b>=top&&alpha(x,b)<224)b--;
      if(b-a+1>=h*.5){corners.top=Math.max(corners.top,a-top);corners.bottom=Math.max(corners.bottom,bottom-b);}
    }
  }
  const protect=side=>Math.ceil(Math.max(short*.25,corners[side]+2));
  const bordersPx={left:axis==='vertical'?0:left+protect('left'),right:axis==='vertical'?0:width-1-right+protect('right'),top:axis==='horizontal'?0:top+protect('top'),bottom:axis==='horizontal'?0:height-1-bottom+protect('bottom')};
  if(bordersPx.left+bordersPx.right>=width*.8||bordersPx.top+bordersPx.bottom>=height*.8)return reject('轮廓保留后可拉伸区域过小。');
  return {status:'supported',method:'filled-contour-v1',bordersPx,nineSlice:sliceSource({width,height,density:resolution,borders:bordersPx}).borders,
    notice:'已按填充轮廓保留边角；渐变与高光会随尺寸拉伸，仍需外观验收。',
    evidence:{bounds:{left,top,right,bottom},filledFraction:filled/(w*h),opaqueInteriorFraction:opaque/total,gradientP95:p95,gradientP99:p99,cornerInsets:corners,protectionFraction:.25,axis}};
}
