// Conservative alpha-connected candidates. Slot identity is assumed, never
// inferred from appearance. No pixel deletion, thresholding, or nearest match.
const intersects=(a,b)=>a[0]<b[0]+b[2]&&b[0]<a[0]+a[2]&&a[1]<b[1]+b[3]&&b[1]<a[1]+a[3];
const contains=(a,b)=>b[0]>a[0]&&b[1]>a[1]&&b[0]+b[2]<a[0]+a[2]&&b[1]+b[3]<a[1]+a[3];
export function locateSheet(image,sheet,coordinates){
  const {width,height,pixels}=image;
  if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=4096)||pixels.length!==width*height*4)throw Error('locate.image');
  if(!(coordinates.width>0&&coordinates.height>0)||width*coordinates.height!==height*coordinates.width)throw Error('locate.aspect-ratio');
  const scale=width/coordinates.width,ids=new Set();
  const slots=sheet.parts.map(p=>{
    const r=p.slotRect;
    if(ids.has(p.assetId)||!Array.isArray(r)||r.length!==4||r.some(n=>!Number.isFinite(n)||n<0)||r[2]<=0||r[3]<=0||r[0]+r[2]>coordinates.width||r[1]+r[3]>coordinates.height)throw Error('locate.slot');
    ids.add(p.assetId);
    const x=Math.floor(r[0]*scale),y=Math.floor(r[1]*scale);
    return{assetId:p.assetId,slot:[x,y,Math.ceil((r[0]+r[2])*scale)-x,Math.ceil((r[1]+r[3])*scale)-y]};
  });
  if(slots.some((s,i)=>slots.slice(0,i).some(t=>intersects(s.slot,t.slot))))throw Error('locate.overlapping-slots');
  const count=width*height,visited=new Uint8Array(count),queue=new Int32Array(count),components=[];
  const slotMap=new Int16Array(count);slotMap.fill(-1);
  for(let k=0;k<slots.length;k++){const [x,y,w,h]=slots[k].slot;for(let yy=y;yy<y+h;yy++)slotMap.fill(k,yy*width+x,yy*width+x+w);}
  let visible=0;for(let i=0;i<count;i++)if(pixels[i*4+3])visible++;
  if(visible===count)return{sheetId:sheet.id,status:'unsupported',reason:'opaque-background',parts:slots.map(s=>({...s,status:'unsupported',crop:null})),components:[],outsideComponents:[],semanticIdentity:'not-verified'};
  for(let seed=0;seed<count;seed++){
    if(visited[seed]||!pixels[seed*4+3])continue;
    if(components.length>=10000)return{sheetId:sheet.id,status:'unsupported',reason:'too-many-alpha-components',parts:slots.map(s=>({...s,status:'unsupported',crop:null})),components:[],outsideComponents:[],semanticIdentity:'not-verified'};
    let head=0,tail=1,minX=width,minY=height,maxX=0,maxY=0,maxAlpha=0,alphaSum=0;queue[0]=seed;visited[seed]=1;
    const distribution=slots.map(s=>({assetId:s.assetId,nonzeroPixels:0,alphaSum:0}));
    while(head<tail){
      const i=queue[head++],x=i%width,y=Math.floor(i/width);
      maxAlpha=Math.max(maxAlpha,pixels[i*4+3]);alphaSum+=pixels[i*4+3];
      const owner=slotMap[i];if(owner>=0){distribution[owner].nonzeroPixels++;distribution[owner].alphaSum+=pixels[i*4+3];}
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
        const j=yy*width+xx;if(!visited[j]&&pixels[j*4+3]){visited[j]=1;queue[tail++]=j;}
      }
    }
    components.push({id:components.length,rect:[minX,minY,maxX-minX+1,maxY-minY+1],pixels:tail,maxAlpha,alphaSum,slotDistribution:distribution.filter(s=>s.nonzeroPixels)});
  }
  const parts=slots.map(s=>{
    const matches=components.filter(c=>intersects(c.rect,s.slot));
    const issues=[];
    if(!matches.length)issues.push('missing');
    if(matches.length>1)issues.push('multiple-components');
    if(matches.some(c=>!contains(s.slot,c.rect)))issues.push('slot-boundary-or-crossing');
    return{...s,status:issues.length?'ambiguous':'candidate',issues,componentIds:matches.map(c=>c.id),crop:issues.length?null:matches[0].rect};
  });
  const outsideComponents=components.filter(c=>!slots.some(s=>intersects(c.rect,s.slot))).map(c=>c.id);
  return{sheetId:sheet.id,status:outsideComponents.length||parts.some(p=>p.status!=='candidate')?'needs-review':'candidate',scale,parts,components,outsideComponents,semanticIdentity:'not-verified'};
}
