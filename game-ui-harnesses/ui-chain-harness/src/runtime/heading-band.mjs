// Versioned visual derivation from pixels that the PNG loader already verified.
// A title material may include both the panel frame and an inset title plaque.
// Only repeated, opaque edges on all four sides provide enough evidence to
// select the plaque. A single border, noisy art or ambiguous image stays whole.
export const referenceHeadingVersion='reference-v1';
export const referenceHeadingLayer=(layer,{width,height})=>layer.mode!=='tile'&&width>=height*2&&layer.width===undefined&&layer.height===undefined&&(layer.offsetX??0)===0&&(layer.offsetY??0)===0&&(layer.scale??1)===1;
const fail=message=>{throw Object.assign(Error(message),{code:'skin.heading-band'});};
function validImage(image){
 const {width,height,pixels}=image??{};
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||pixels?.length!==width*height*4)fail('Invalid verified heading image.');
 return image;
}
function edgeGroups(image,axis,start,end){
 const {width,height,pixels}=image,length=axis==='y'?height:width,cross=axis==='y'?width:height,indices=[];
 const a=Math.ceil(cross*start),b=Math.floor(cross*end);
 for(let i=1;i<length;i++){
  let opaque=0,strong=0;
  for(let j=a;j<b;j++){
   const at=((axis==='y'?i:j)*width+(axis==='y'?j:i))*4,previous=at-(axis==='y'?width*4:4);
   if(pixels[at+3]<240||pixels[previous+3]<240)continue;
   opaque++;
   if(Math.abs(pixels[at]-pixels[previous])+Math.abs(pixels[at+1]-pixels[previous+1])+Math.abs(pixels[at+2]-pixels[previous+2])>=24)strong++;
  }
  if(opaque>=(b-a)*.95&&strong>=(b-a)*.75)indices.push(i);
 }
 const groups=[],gap=Math.max(4,Math.round(Math.min(width,height)*.03));
 for(const index of indices){const last=groups.at(-1);if(last&&index-last.end<=gap)last.end=index;else groups.push({start:index,end:index});}
 return groups;
}
function nestedPair(groups,length,maxSpan=.94){
 const before=groups.filter(g=>g.end<length*.45),after=groups.filter(g=>g.start>length*.55);
 if(before.length<2||after.length<2)return null;
 const low=before.at(-1),high=after[0],outerLow=before.at(-2),outerHigh=after[1];
 const start=low.start-1,end=high.end+1,span=end-start;
 if(start<length*.02||end>length*.98||span<length*.3||span>length*maxSpan||Math.abs((start+end)/2-length/2)>length*.06)return null;
 if(low.start-outerLow.end<length*.01||outerHigh.start-high.end<length*.01)return null;
 if(Math.abs((low.start-outerLow.end)-(outerHigh.start-high.end))>length*.08)return null;
 return {start,end,inner:[low,high],outer:[outerLow,outerHigh]};
}
const colorDistance=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
function paletteAtEdges(image,rows,columns,rect){
 const {width,height,pixels}=image,colors=new Map();
 const take=(x,y)=>{if(x<0||y<0||x>=width||y>=height)return;const at=(y*width+x)*4;if(pixels[at+3]<240)return;const c=[pixels[at],pixels[at+1],pixels[at+2]].map(v=>Math.min(255,Math.floor(v/16)*16+8));colors.set(c.join(','),c);};
 for(const g of rows)for(let y=g.start-1;y<=g.end;y++)for(let x=Math.ceil(rect.x+rect.width*.2);x<rect.x+rect.width*.8;x+=Math.max(1,Math.floor(rect.width/160)))take(x,y);
 for(const g of columns)for(let x=g.start-1;x<=g.end;x++)for(let y=Math.ceil(rect.y+rect.height*.3);y<rect.y+rect.height*.7;y+=Math.max(1,Math.floor(rect.height/80)))take(x,y);
 return [...colors.values()];
}
function connectedOuterCornerCuts(image,rect,evidence){
 const {width,height,pixels}=image,inner=paletteAtEdges(image,evidence.rows.inner,evidence.columns.inner,rect),outer=paletteAtEdges(image,evidence.rows.outer,evidence.columns.outer,{x:0,y:0,width,height});
 const distinctive=outer.filter(c=>inner.every(p=>colorDistance(c,p)>120));
 if(!distinctive.length)return null;
 const isOuterAccent=(x,y)=>{const at=(y*width+x)*4,c=[pixels[at],pixels[at+1],pixels[at+2]];return pixels[at+3]>=240&&distinctive.some(p=>colorDistance(c,p)<=72)&&inner.every(p=>colorDistance(c,p)>96);};
 const cuts={},names=['topLeft','topRight','bottomRight','bottomLeft'];
 for(let index=0;index<4;index++){
  const right=index===1||index===2,bottom=index>=2,col=evidence.columns.inner[right?1:0],row=evidence.rows.inner[bottom?1:0];
  const limitX=Math.ceil(Math.min(rect.width*.1,rect.height*.3,(col.end-col.start+1)*2)),limitY=Math.ceil(Math.min(rect.height*.3,(row.end-row.start+1)*2));
  const visited=new Set(),queue=[];let cutX=0,cutY=0;
  const coordinate=(x,y)=>({x:right?rect.x+rect.width-1-x:rect.x+x,y:bottom?rect.y+rect.height-1-y:rect.y+y});
  const add=(x,y)=>{const key=x+','+y;if(visited.has(key)||x< -2||y< -2||x>=limitX||y>=limitY)return;visited.add(key);const p=coordinate(x,y);if(p.x<0||p.y<0||p.x>=width||p.y>=height||!isOuterAccent(p.x,p.y))return;queue.push({x,y});};
  // A unique color inside a title corner may be intentional decoration. Only
  // an accent connected to the enclosing artwork outside this crop can mask.
  for(let x=-2;x<limitX;x++)for(let y=-2;y<0;y++)add(x,y);
  for(let y=0;y<limitY;y++)for(let x=-2;x<0;x++)add(x,y);
  for(let at=0;at<queue.length;at++){
   const p=queue[at];if(p.x>=0&&p.y>=0){cutX=Math.max(cutX,p.x+1);cutY=Math.max(cutY,p.y+1);}
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)add(p.x+dx,p.y+dy);
  }
  if(cutX&&cutY)cuts[names[index]]={width:cutX,height:cutY};
 }
 return Object.keys(cuts).length?{method:'connected-outer-accent-v1',...cuts}:null;
}
export function completeReferenceHeadingRegion(width,height){
 if(![width,height].every(n=>Number.isFinite(n)&&n>0))fail('Invalid heading source dimensions.');
 const cap=Math.min(height,Math.floor(width*.22));
 return {version:referenceHeadingVersion,sourceWidth:width,sourceHeight:height,sourceRect:{x:0,y:0,width,height},caps:{left:cap,right:cap},method:'complete-source-v1'};
}
export function deriveReferenceHeadingRegion(source){
 const image=validImage(source),{width,height}=image;
 let rect={x:0,y:0,width,height},evidence=null;
 if(width>=height*2&&height>=24){
  const rows=nestedPair(edgeGroups(image,'y',.2,.8),height,.8);
  if(rows){
   const inset=(rows.end-rows.start)*.23;
   const columns=nestedPair(edgeGroups(image,'x',(rows.start+inset)/height,(rows.end-inset)/height),width);
   if(columns){
    rect={x:columns.start,y:rows.start,width:columns.end-columns.start,height:rows.end-rows.start};
    evidence={rows:{inner:rows.inner,outer:rows.outer},columns:{inner:columns.inner,outer:columns.outer}};
   }
  }
 }
 // Each end keeps a complete source-height worth of artwork. At display time
 // the ends use the same scale on both axes; only the quiet middle stretches.
 const cap=Math.min(rect.height,Math.floor(rect.width*.22));
 const cornerCuts=evidence?connectedOuterCornerCuts(image,rect,evidence):null;
 return {version:referenceHeadingVersion,sourceWidth:width,sourceHeight:height,sourceRect:rect,caps:{left:cap,right:cap},method:evidence?'nested-opaque-frame-v1':'complete-source-v1',...(evidence?{evidence}:{}),...(cornerCuts?{cornerCuts}:{})};
}
export function prepareReferenceHeadingBands(pack,images){
 const result=new Map();
 for(const key of ['title','section'])for(const layer of pack.surfaceStyles?.[key]?.layers??[]){
  if(layer.mode==='tile'||result.has(layer.assetId))continue;
  const image=images.get(layer.assetId);if(!image)fail('Missing verified heading material pixels.');
  if(!referenceHeadingLayer(layer,image))continue;
  result.set(layer.assetId,deriveReferenceHeadingRegion(image));
 }
 return result;
}
export function referenceHeadingLayout(region,width,height){
 if(!region||region.version!==referenceHeadingVersion||![width,height].every(n=>Number.isFinite(n)&&n>0))fail('Invalid reference heading dimensions.');
 const rect=region.sourceRect,scale=height/rect.height,left=region.caps.left*scale,right=region.caps.right*scale;
 if(width<left+right+1)fail('Reference heading width cannot preserve both end ornaments.');
 return {scale,left,right,middle:width-left-right,width,height};
}
