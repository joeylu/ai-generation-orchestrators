import {encodeRgbaPng} from '../../src/png.mjs';

// Synthetic industrial layout, canonical 256x144; never provider/user artwork.
export const dockColors={sky:[186,209,222,255],warehouse:[118,132,148,255],
  rear:[67,91,112,255],hook:[220,177,58,255],cargo:[189,94,54,255],
  front:[40,65,83,255],deck:[82,82,89,255]};
const forms={warehouse:[[12,38,67,67],[20,28,51,10]],rear:[[103,26,12,95],[103,26,111,12],[103,100,111,8]],
  hook:[[174,38,3,55],[174,87,16,7],[186,82,4,12]],cargo:[[154,70,73,51]],
  front:[[204,26,10,95]],deck:[[0,121,256,23]]};
export const dockOrder=['warehouse','rear','hook','cargo','front','deck'];
export function dockRaster(order=dockOrder){
  const width=512,height=288,rgba=Buffer.alloc(width*height*4);
  for(let i=0;i<width*height;i++)rgba.set(dockColors.sky,i*4);
  for(const name of order)for(const [x,y,w,h] of forms[name])
    for(let py=y*2;py<(y+h)*2;py++)for(let px=x*2;px<(x+w)*2;px++)rgba.set(dockColors[name],(py*width+px)*4);
  return {width,height,rgba,png:encodeRgbaPng(width,height,rgba)};
}
export const dockParts=[
  {id:'rear',content:'Rear machine upright, overhead beam and lower crossbar; cargo passes in front of this part. Hidden continuation behind cargo is design inference.',exclusions:['Front machine column','Cargo and suspended hook'],box:[103,26,111,95]},
  {id:'hook',content:'Suspended hook and cable, independently animated. The hook tip hidden by cargo is a design assumption, not an observed endpoint.',exclusions:['Machine beam and columns','Cargo'],box:[174,38,16,56]},
  {id:'cargo',content:'One movable cargo container; keep it independent of the deck material and the machine. Its rear wall is unseen and inferred.',exclusions:['Machine columns and hook','Playable deck'],box:[154,70,73,51]},
  {id:'front',content:'Front machine column, placed in front of cargo and independent of the rear beam. Retain its compact foot only.',exclusions:['Rear machine beam','Cargo and suspended hook','Playable deck'],box:[204,26,10,95]}
];
