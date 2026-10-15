export function compareCrops(image,baseline,proposal){
  for(const r of [baseline,proposal])if(!Array.isArray(r)||r.length!==4||!r.every(Number.isInteger)||r[0]<0||r[1]<0||r[2]<=0||r[3]<=0||r[0]+r[2]>image.width||r[1]+r[3]>image.height)throw Error('compare.crop-bounds');
  const stats=()=>({nonzeroPixels:0,alphaSum:0,maxAlpha:0});
  const result={shared:stats(),baselineOnly:stats(),proposalOnly:stats()};
  const hit=(r,x,y)=>x>=r[0]&&y>=r[1]&&x<r[0]+r[2]&&y<r[1]+r[3];
  const left=Math.min(baseline[0],proposal[0]),top=Math.min(baseline[1],proposal[1]);
  const right=Math.max(baseline[0]+baseline[2],proposal[0]+proposal[2]),bottom=Math.max(baseline[1]+baseline[3],proposal[1]+proposal[3]);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const a=hit(baseline,x,y),b=hit(proposal,x,y),alpha=image.pixels[(y*image.width+x)*4+3];
    if(!alpha||(!a&&!b))continue;
    const s=a&&b?result.shared:a?result.baselineOnly:result.proposalOnly;
    s.nonzeroPixels++;s.alphaSum+=alpha;s.maxAlpha=Math.max(s.maxAlpha,alpha);
  }
  return result;
}
