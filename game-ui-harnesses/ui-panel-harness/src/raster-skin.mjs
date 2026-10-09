/** Deterministic indexed PNG primitives; no browser Canvas, filesystem or model. */
const u32 = value => Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
const join = parts => { const out = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let at=0; for(const p of parts){out.set(p,at);at+=p.length;} return out; };
const crc = bytes => { let c=0xffffffff; for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);} return (c^0xffffffff)>>>0; };
const chunk = (type,data) => { const body=join([new TextEncoder().encode(type),data]); return join([u32(data.length),body,u32(crc(body))]); };
function storedZlib(bytes) {
  const parts=[Uint8Array.of(0x78,0x01)]; let a=1,b=0;
  for(const value of bytes){a=(a+value)%65521;b=(b+a)%65521;}
  for(let i=0;i<bytes.length;i+=65535){const n=Math.min(65535,bytes.length-i);parts.push(Uint8Array.of(i+n===bytes.length?1:0,n&255,n>>>8,(~n)&255,((~n)>>>8)&255),bytes.subarray(i,i+n));}
  return join([...parts,u32((b<<16)|a)]);
}
export function png(width,height,colors,pixel) {
  // Four alpha levels per color, packed into a bounded 4-bit indexed PNG.
  const palette=[0,0,0],alpha=[0];
  for(const color of colors)for(let level=1;level<=4;level++){
    palette.push(...[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)));alpha.push(Math.round(255*level/4));
  }
  const stride=Math.ceil(width/2)+1,data=new Uint8Array(stride*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*stride+1+(x>>1)]|=pixel(x,y)<<(x%2?0:4);
  return join([Uint8Array.of(137,80,78,71,13,10,26,10),chunk('IHDR',join([u32(width),u32(height),Uint8Array.of(4,3,0,0,0)])),chunk('PLTE',Uint8Array.from(palette)),chunk('tRNS',Uint8Array.from(alpha)),chunk('IDAT',storedZlib(data)),chunk('IEND',new Uint8Array())]);
}
/** Full RGBA for layered artwork; callbacks return straight alpha, invisible RGB is normalized. */
export function rgbaPng(width,height,pixel) {
  const stride=1+width*4,data=new Uint8Array(stride*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const color=pixel(x,y),offset=y*stride+1+x*4;
    if(color[3]>0)data.set(color,offset);
  }
  return join([Uint8Array.of(137,80,78,71,13,10,26,10),chunk('IHDR',join([u32(width),u32(height),Uint8Array.of(8,6,0,0,0)])),chunk('IDAT',storedZlib(data)),chunk('IEND',new Uint8Array())]);
}
function rounded(x,y,width,height,radius,inset=0) {
  const r=Math.max(0,Math.min(radius-inset,(width-2*inset)/2,(height-2*inset)/2));
  if(x<inset||y<inset||x>=width-inset||y>=height-inset)return false;
  const dx=Math.max(inset+r-x,0,x-(width-inset-r)),dy=Math.max(inset+r-y,0,y-(height-inset-r));
  return dx*dx+dy*dy<=r*r;
}
export function plate(width,height,radius,colors) {
  return png(width,height,colors,(x,y)=>{
    let outer=0,inner=0;
    for(const dx of [.25,.75])for(const dy of [.25,.75]){outer+=rounded(x+dx,y+dy,width,height,radius);inner+=rounded(x+dx,y+dy,width,height,radius,1);}
    return inner?inner:outer?4+outer:0;
  });
}
