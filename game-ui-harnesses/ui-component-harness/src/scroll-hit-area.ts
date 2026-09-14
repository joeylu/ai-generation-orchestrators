/** Viewport and authored scrollbar are separate hit regions; the gap is inert. */
export function scrollHitArea(viewport: {width:number;height:number}, track: {x:number;y:number;width:number;height:number}) {
  return { contains(x:number,y:number):boolean {
    return (x>=0 && y>=0 && x<=viewport.width && y<=viewport.height)
      || (x>=track.x && y>=track.y && x<=track.x+track.width && y<=track.y+track.height);
  }};
}
