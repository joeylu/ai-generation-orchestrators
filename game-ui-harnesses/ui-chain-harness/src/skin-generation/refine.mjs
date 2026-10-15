// Explicit candidate-only pixel processing. No inference, recoloring of interiors,
// alpha hard threshold, generation or modification of the preserved raw image.
const fail=message=>{throw Object.assign(Error(message),{code:'skin.normalize'});};
const clone=im=>({...im,pixels:Buffer.from(im.pixels)});
function coreBounds(im,threshold){
  let x0=im.width,y0=im.height,x1=-1,y1=-1;
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)if(im.pixels[(y*im.width+x)*4+3]>=threshold){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<x0)fail('Refinement needs a visible core.');return [x0,y0,x1+1,y1+1];
}
function axisMap(length,source0,source1,target0,target1){
  // Pixel-edge mapping. Transparent canvas around the core is retained.
  return x=>x<target0?x*source0/target0:x>target1?source1+(x-target1)*(length-source1)/(length-target1):source0+(x-target0)*(source1-source0)/(target1-target0);
}
function hueAndSaturation(r,g,b){
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  const h=!d?0:max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);
  return [(h+360)%360,max?d/max:0];
}
function edgeDistances(im,threshold){
  const n=im.width*im.height,dist=new Int16Array(n);dist.fill(32767);
  const queue=new Int32Array(n);let head=0,tail=0;
  for(let i=0;i<n;i++)if(im.pixels[i*4+3]<threshold||i%im.width===0||i%im.width===im.width-1||i<im.width||i>=n-im.width){dist[i]=0;queue[tail++]=i;}
  while(head<tail){const i=queue[head++],x=i%im.width;for(const j of [x?i-1:-1,x+1<im.width?i+1:-1,i>=im.width?i-im.width:-1,i+im.width<n?i+im.width:-1])if(j>=0&&dist[j]>dist[i]+1){dist[j]=dist[i]+1;queue[tail++]=j;}}
  return dist;
}
export function repairEdgeColors(image,policy){
  const out=clone(image),dist=edgeDistances(image,policy.coreAlpha),rejectedHue=(r,g,b)=>{const[h,s]=hueAndSaturation(r,g,b);return s>=policy.minSaturation&&policy.hueRanges.some(([a,b])=>h>=a&&h<=b);};
  let changedPixels=0,unresolvedPixels=0,visiblePixels=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const at=y*image.width+x,i=at*4,a=image.pixels[i+3];if(!a)continue;visiblePixels++;
    if(dist[at]>policy.bandPixels||!rejectedHue(...image.pixels.subarray(i,i+3)))continue;
    let best=-1,bestDistance=Infinity;
    for(let dy=-policy.searchRadius;dy<=policy.searchRadius;dy++)for(let dx=-policy.searchRadius;dx<=policy.searchRadius;dx++){
      const nx=x+dx,ny=y+dy,d=dx*dx+dy*dy;if(nx<0||ny<0||nx>=image.width||ny>=image.height||d>=bestDistance)continue;
      const j=ny*image.width+nx,k=j*4;
      if(image.pixels[k+3]<policy.coreAlpha||dist[j]<=policy.bandPixels||rejectedHue(...image.pixels.subarray(k,k+3)))continue;
      best=k;bestDistance=d;
    }
    if(best<0){unresolvedPixels++;continue;}
    image.pixels.copy(out.pixels,i,best,best+3);changedPixels++;
  }
  if(changedPixels/Math.max(1,visiblePixels)>policy.maxChangedPixelFraction)fail('Edge color repair exceeds configured pixel budget.');
  if(unresolvedPixels>policy.maxUnresolvedPixels)fail('Edge color repair cannot find enough reliable interior colors.');
  return {image:out,operation:{method:'edge-hue-replace-from-nearest-interior',changedPixels,unresolvedPixels,visiblePixels,alphaChanged:false}};
}
// A fitted geometric alpha ceiling removes connected whiskers as well as stray
// rings. It only reduces alpha, preserves holes and never blurs material RGB.
export function smoothOuterEnvelope(image,primitive,policy){
  const box=coreBounds(image,policy.coreAlpha),pad=policy.paddingPixels-(policy.insetPixels??0);
  const [x0,y0,x1,y1]=[box[0]-pad,box[1]-pad,box[2]+pad,box[3]+pad],w=x1-x0,h=y1-y0,cx=(x0+x1)/2,cy=(y0+y1)/2;
  if(!['circle','roundRect'].includes(primitive.type))fail('Smooth envelope only supports circles and capsules.');
  if(primitive.type==='roundRect'&&primitive.radius<=0)fail('Smooth envelope needs a capsule primitive.');
  const out=clone(image);let originalMass=0,removedMass=0,changedPixels=0,visibleBefore=0,visibleAfter=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const i=(y*image.width+x)*4,a=image.pixels[i+3];originalMass+=a;if(a)visibleBefore++;
    const dx=Math.abs(x+0.5-cx),dy=Math.abs(y+0.5-cy);
    const distance=primitive.type==='circle'?(Math.hypot(dx/(w/2),dy/(h/2))-1)*Math.min(w,h)/2
      :w>=h?Math.hypot(Math.max(0,dx-(w-h)/2),dy)-h/2
      :Math.hypot(dx,Math.max(0,dy-(h-w)/2))-w/2;
    const ceiling=Math.round(255*Math.max(0,Math.min(1,0.5-distance/policy.featherPixels))),alpha=Math.min(a,ceiling);
    out.pixels[i+3]=alpha;if(alpha)visibleAfter++;else out.pixels.fill(0,i,i+3);
    if(alpha!==a){changedPixels++;removedMass+=a-alpha;}
  }
  const fraction=removedMass/Math.max(1,originalMass);
  if(fraction>policy.maxRemovedAlphaMassFraction)fail('Smooth envelope would remove too much original alpha.');
  return {image:out,operation:{method:'fitted-smooth-alpha-ceiling',fittedCore:box,envelope:[x0,y0,x1,y1],
    changedPixels,visibleBefore,visibleAfter,removedAlphaMass:removedMass,removedAlphaMassFraction:fraction,
    rgbInteriorChanged:false,alphaCanIncrease:false}};
}
export function refineAssets(assets,stateGroups,policy,resample){
  if(!policy)return {assets,report:{enabled:false}};
  const updated=assets.map(a=>({...a,baselineImage:clone(a.image),image:clone(a.image),operation:{...a.operation,refinement:[]}})),groups=[];
  if(policy.states.enabled)for(const g of stateGroups){
    const members=g.assetIds.map(id=>updated.find(a=>a.part.assetId===id));
    if(members.some(a=>!a))continue;
    const [width,height]=[members[0].image.width,members[0].image.height];
    if(members.some(a=>a.image.width!==width||a.image.height!==height))fail('State group canvases differ.');
    const bounds=members.map(a=>coreBounds(a.image,policy.states.coreAlpha));
    // Use a centered common frame no larger than the smallest source core.
    const w=Math.min(...bounds.map(b=>b[2]-b[0])),h=Math.min(...bounds.map(b=>b[3]-b[1]));
    const target=[Math.floor((width-w)/2),Math.floor((height-h)/2),Math.floor((width-w)/2)+w,Math.floor((height-h)/2)+h];
    const warped=members.map((a,i)=>{
      const b=bounds[i],scales=[w/(b[2]-b[0]),h/(b[3]-b[1])];
      if(Math.max(...scales.map(s=>Math.max(s,1/s)))>policy.states.maxAxisScaleChange)fail('State alignment exceeds configured axis change.');
      return resample(a.image,width,height,axisMap(width,b[0],b[2],target[0],target[2]),axisMap(height,b[1],b[3],target[1],target[3]));
    });
    const common=new Uint8Array(width*height);
    for(let i=0;i<common.length;i++)common[i]=Math.min(...warped.map(im=>im.pixels[i*4+3]));
    const losses=[];
    members.forEach((a,i)=>{
      const im=warped[i];let alphaMass=0,removed=0;
      for(let p=0;p<common.length;p++){const k=p*4;alphaMass+=im.pixels[k+3];removed+=im.pixels[k+3]-common[p];im.pixels[k+3]=common[p];if(!common[p])im.pixels.fill(0,k,k+3);}
      const fraction=removed/Math.max(1,alphaMass);if(fraction>policy.states.maxRemovedAlphaMassFraction)fail('Common state silhouette would remove too much alpha.');
      a.image=im;a.operation.refinement.push({method:'core-frame-and-shared-min-alpha',sourceCore:bounds[i],targetCore:target,removedAlphaMass:removed,removedAlphaMassFraction:fraction});losses.push({assetId:a.part.assetId,removedAlphaMassFraction:fraction});
    });
    groups.push({id:g.id,assetIds:g.assetIds,targetCore:target,sharedAlphaIdentical:true,losses});
  }
  const envelopes=[];
  if(policy.smoothEnvelope?.enabled)for(const a of updated){
    const p=a.part.primitive;
    if(p.type==='roundRect'&&p.radius!==Math.min(a.part.bodyRect[2],a.part.bodyRect[3])/2)fail('Smooth envelope needs an explicitly supported capsule.');
    const r=smoothOuterEnvelope(a.image,p,policy.smoothEnvelope);a.image=r.image;a.operation.refinement.push(r.operation);envelopes.push({assetId:a.part.assetId,...r.operation});
  }
  const edges=[];
  if(policy.edgeColor.enabled)for(const a of updated){const r=repairEdgeColors(a.image,policy.edgeColor);a.image=r.image;a.operation.refinement.push(r.operation);edges.push({assetId:a.part.assetId,...r.operation});}
  return {assets:updated,report:{enabled:true,states:groups,smoothEnvelopes:envelopes,edgeColors:edges,visualAcceptance:'unreviewed'}};
}
