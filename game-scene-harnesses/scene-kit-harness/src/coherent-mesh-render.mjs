import {check} from './generation/common.mjs';
import {validateMeshCoverage} from './mesh-coverage.mjs';

// Deterministic diagnostic counterpart of Pixi's indexed body/cap meshes.
// Linear filtering happens in premultiplied RGBA; only the cap clamps in V.
export function paintCoherentMesh(pixels, viewport, data, texture, {left=0,top=0,cap=false,clampU=false,clampV=cap,tint=0xffffff,opacity=1,topLeftRule=false}={}) {
  check(Number.isFinite(opacity)&&opacity>=0&&opacity<=1,'COHERENT_MESH_OPACITY');
  const vertexCoverage=validateMeshCoverage(data)?data.vertexCoverage:null;
  const {width,height}=viewport, painted=new Uint8Array(width*height);
  const wrap=(n,period)=>(n%period+period)%period;
  const sample=(u,v)=>{
    const px=u*texture.width-.5,py=v*texture.height-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
    const out=[0,0,0,0];
    for(const [dx,dy,w]of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
      const x=clampU?Math.max(0,Math.min(texture.width-1,x0+dx)):wrap(x0+dx,texture.width),y=clampV?Math.max(0,Math.min(texture.height-1,y0+dy)):wrap(y0+dy,texture.height);
      const p=(y*texture.width+x)*4,a=texture.rgba[p+3]/255;
      for(let c=0;c<3;c++)out[c]+=texture.rgba[p+c]*a*w;
      out[3]+=a*w;
    }return out;
  };
  const colors=[tint>>16&255,tint>>8&255,tint&255];
  check(data.positions.length===data.uvs.length&&data.indices.length%3===0,'COHERENT_MESH_GEOMETRY');
  for(let i=0;i<data.indices.length;i+=3){
    const ids=data.indices.slice(i,i+3),points=ids.map(n=>({x:data.positions[n*2]-left,y:data.positions[n*2+1]-top}));
    const [a,b,c]=points,den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(den)<1e-12)continue;
    const x0=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),x1=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
    const y0=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),y1=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const p=y*width+x;if(painted[p])continue;
      const px=x+.5,py=y+.5,w0=((b.y-c.y)*(px-c.x)+(c.x-b.x)*(py-c.y))/den;
      const w1=((c.y-a.y)*(px-c.x)+(a.x-c.x)*(py-c.y))/den,w2=1-w0-w1;
      if(Math.min(w0,w1,w2)<-1e-9)continue;
      if(topLeftRule){
        const owned=(p0,p1)=>{const dx=p1.x-p0.x,dy=p1.y-p0.y;return den<0?(dy>1e-9||Math.abs(dy)<=1e-9&&dx<0):(dy<-1e-9||Math.abs(dy)<=1e-9&&dx>0);};
        if(Math.abs(w0)<=1e-9&&!owned(b,c)||Math.abs(w1)<=1e-9&&!owned(c,a)||Math.abs(w2)<=1e-9&&!owned(a,b))continue;
      }
      painted[p]=1;const weights=[w0,w1,w2];let u=0,v=0;
      ids.forEach((n,j)=>{u+=data.uvs[n*2]*weights[j];v+=data.uvs[n*2+1]*weights[j];});
      const coverage=vertexCoverage?Math.max(0,Math.min(1,ids.reduce((n,id,j)=>n+vertexCoverage[id]*weights[j],0))):1,
        effectiveOpacity=vertexCoverage?opacity*coverage:opacity,
        rgba=sample(u,v).map(value=>value*effectiveOpacity),offset=p*4;
      for(let channel=0;channel<3;channel++)pixels[offset+channel]=Math.round(rgba[channel]*colors[channel]/255+pixels[offset+channel]*(1-rgba[3]));
    }
  }
}
