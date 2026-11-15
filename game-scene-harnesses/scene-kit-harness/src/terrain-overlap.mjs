// All tests use the rendered, quantized surface polylines, rather than artwork
// alpha or the coarse bounding boxes. Touching edges have no shared solid area.
export const LAYERED_TERRAIN_PROFILE=Object.freeze({profile:'layered-terrain-solids-v1',
  geometry:'compiled-surface-polyline-and-grid-cell-rectangles',overlap:'positive-area-intersection',
  touching:'allowed-without-automatic-join',tolerance:0.000001});
const EPS=LAYERED_TERRAIN_PROFILE.tolerance;
const height=(a,b,x)=>a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);
function segmentAt(line,x){let lo=1,hi=line.length-1;while(lo<hi){const m=(lo+hi)>>1;if(line[m].x<=x)lo=m+1;else hi=m;}return lo;}
export function surfaceMinimum(line,left,right){
  left=Math.max(left,line[0].x);right=Math.min(right,line.at(-1).x);
  if(right-left<=EPS)return Infinity;
  let i=segmentAt(line,left),minimum=Infinity;
  while(i<line.length){const a=line[i-1],b=line[i],end=Math.min(right,b.x);minimum=Math.min(minimum,height(a,b,left),height(a,b,end));if(end>=right-EPS)break;left=end;i++;}
  return minimum;
}
export function gridColumnIndex(cells){
  const columns=new Map();
  for(const key of cells.keys()){const [x,y]=key.split(',').map(Number);if(!columns.has(x))columns.set(x,[]);columns.get(x).push(y);}
  for(const rows of columns.values())rows.sort((a,b)=>a-b);
  return columns;
}
export function gridCurveConflict(curves,columns,grid){
  for(const curve of curves){const line=curve.surface,baseY=curve.baseY??curve.contour.at(-2).y;
    const start=Math.floor(line[0].x/grid.width),end=Math.ceil(line.at(-1).x/grid.width);
    for(let column=start;column<end;column++){
      const rows=columns.get(column);if(!rows)continue;
      const top=surfaceMinimum(line,column*grid.width,(column+1)*grid.width);if(!Number.isFinite(top))continue;
      let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if((rows[m]+1)*grid.height<=top+EPS)lo=m+1;else hi=m;}
      if(lo<rows.length&&rows[lo]*grid.height<baseY-EPS)return {curveId:curve.curveId,cell:{x:column,y:rows[lo]}};
    }
  }
  return null;
}
export function curveSolidsOverlap(a,b){
  const al=a.surface,bl=b.surface,base=Math.min(a.baseY??a.contour.at(-2).y,b.baseY??b.contour.at(-2).y);
  let x=Math.max(al[0].x,bl[0].x),end=Math.min(al.at(-1).x,bl.at(-1).x);if(end-x<=EPS)return false;
  let i=segmentAt(al,x),j=segmentAt(bl,x);
  while(x<end-EPS){
    const right=Math.min(al[i].x,bl[j].x,end),ay=height(al[i-1],al[i],x),by=height(bl[j-1],bl[j],x),ar=height(al[i-1],al[i],right),br=height(bl[j-1],bl[j],right);
    let minimum=Math.min(Math.max(ay,by),Math.max(ar,br));
    const d0=ay-by,d1=ar-br;
    if(d0*d1<0){const t=d0/(d0-d1);minimum=Math.min(minimum,ay+(ar-ay)*t);}
    if(minimum<base-EPS)return true;
    x=right;if(al[i].x<=x+EPS&&i<al.length-1)i++;if(bl[j].x<=x+EPS&&j<bl.length-1)j++;
  }
  return false;
}
