// Geometry only: faint transparent residue must not move a selection indicator.
// Keep every source pixel; fall back to all nonzero alpha for translucent art.
export function visibleSelectionBounds({width,height,pixels}){
  const all=[width,height,-1,-1],visible=[width,height,-1,-1];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const alpha=pixels[(y*width+x)*4+3];
    if(!alpha)continue;
    for(const bounds of alpha>=32?[all,visible]:[all]){
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);
      bounds[2]=Math.max(bounds[2],x+1);bounds[3]=Math.max(bounds[3],y+1);
    }
  }
  const b=visible[2]>=0?visible:all;
  return b[2]<0?{x:0,y:0,width:1,height:1}:{x:b[0]/width,y:b[1]/height,width:(b[2]-b[0])/width,height:(b[3]-b[1])/height};
}
const full={x:0,y:0,width:1,height:1};
export function selectionMarkGeometry(size,base=full,mark=full,radio=false){
  const nominal=size-8;
  // Keep a radio dot inside the ring's visible diameter, even when the ring
  // has much more transparent padding than its separately generated dot.
  const scale=radio?Math.min(1,base.width*size*2/3/(mark.width*nominal),base.height*size*2/3/(mark.height*nominal)):1;
  const extent=nominal*scale;
  return {width:extent,height:extent,x:(base.x+base.width/2)*size-(mark.x+mark.width/2)*extent,y:(base.y+base.height/2)*size-(mark.y+mark.height/2)*extent};
}
