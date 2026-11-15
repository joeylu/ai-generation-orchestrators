import {encodeRgbaPng} from '../png.mjs';
import {check,deepFreeze,imageRef,seal} from './common.mjs';

export const SOURCE_VISUAL_GUIDE_PROFILE='deep-shadow-complete-fixture-v1';
export const SOURCE_VISUAL_GUIDE_ROLE='neutral-deep-shadow-complete-fixture-example';
export const SOURCE_VISUAL_GUIDE_INSTRUCTION=[
  'TECHNICAL INPUT 2 demonstrates ONLY majority-surface deep shadow and one complete closed contour: most front, side AND top faces are dark, with very few thin rim marks and a tiny indicator; ports have closed ends, small connections return to their own body, and compact mounts are complete.',
  'Use this value hierarchy and completeness principle only. Do not copy its sample box, pipes, mounting structure, shape, quantity, count, layout, framing, proportions, grayscale palette, flat drawing style or blank background. It supplies no requested content or scene composition. The light gray surround is technical display space, never the requested output background; a transparent source still requires real transparency.',
  'Input 1 remains the accepted scene reference for original material hues, brushwork, light direction and color temperature. It does not override the newly requested darker foreground exposure. Only the accepted written scope decides subject identity, content, attachments, counts, placement and style. Draw the requested source with its own material colors and readable deep-shadow structure, including a dark top face; do not gray-convert it or brighten broad faces to match the reference exposure.',
  'This neutral program-drawn example is not final artwork, a generated source, a source-image edit, proof of semantic correctness, art acceptance or authorization for image generation.',
].join('\n\n');

export const SOURCE_VISUAL_GUIDE_RECIPE=deepFreeze(seal({
  format:'ai_scene_source_visual_guide_recipe_v1',
  compiler:'scene-kit-source-visual-guide-v1',profile:SOURCE_VISUAL_GUIDE_PROFILE,role:SOURCE_VISUAL_GUIDE_ROLE,
  pixelSize:{width:1024,height:576},alpha:'opaque',drawing:'fixed-neutral-program-raster',
  background:{gray:232,purpose:'technical-surround-only-not-requested-output-background'},
  faceGrays:{front:26,side:18,top:30,outline:12,pipe:24,thinRim:55,tinyIndicator:64},
  minimumBlankMarginPercent:12,
  example:'one-simple-closed-fixture-with-returning-small-pipe-closed-port-and-compact-mounts',
  guidance:['majority-front-side-and-top-surfaces-in-deep-shadow','complete-outer-contour-closed-ports-and-local-connections'],
  excludedGuidance:['subject-identity','content','count','structure','composition','framing','style','material-hue','output-background'],
  instruction:SOURCE_VISUAL_GUIDE_INSTRUCTION,maximumNewImageCalls:0,sourceInputs:0,
  sourcePngModified:false,sourceArtAcceptance:'not-granted',finalArtwork:false,
}));

function renderGuide(){
  const width=1024,height=576,rgba=Buffer.alloc(width*height*4);
  const dot=(x,y,gray)=>{if(x<0||y<0||x>=width||y>=height)return;const p=(y*width+x)*4;rgba[p]=gray;rgba[p+1]=gray;rgba[p+2]=gray;rgba[p+3]=255;};
  const rect=(x,y,w,h,gray)=>{for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)dot(px,py,gray);};
  const disk=(x,y,r,gray)=>{for(let py=y-r;py<=y+r;py++)for(let px=x-r;px<=x+r;px++)if((px-x)**2+(py-y)**2<=r*r)dot(px,py,gray);};
  const line=(a,b,gray,radius=0)=>{
    let [x,y]=a;const [endX,endY]=b,dx=Math.abs(endX-x),sx=x<endX?1:-1,dy=-Math.abs(endY-y),sy=y<endY?1:-1;let error=dx+dy;
    for(;;){disk(x,y,radius,gray);if(x===endX&&y===endY)break;const twice=error*2;if(twice>=dy){error+=dy;x+=sx;}if(twice<=dx){error+=dx;y+=sy;}}
  };
  const chain=(points,gray,radius)=>{for(let i=1;i<points.length;i++)line(points[i-1],points[i],gray,radius);};
  const polygon=(points,gray)=>{
    const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
    for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
      let inside=false;const px=x+.5,py=y+.5;
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const [xi,yi]=points[i],[xj,yj]=points[j];
        if((yi>py)!==(yj>py)&&px<(xj-xi)*(py-yi)/(yj-yi)+xi)inside=!inside;
      }
      if(inside)dot(x,y,gray);
    }
  };
  rect(0,0,width,height,232);

  // The compact connections belong to this single example, without a host wall
  // or floor. They are not prescriptions for the requested source structure.
  for(const y of [200,321]){
    rect(707,y+10,45,15,12);rect(709,y+12,41,11,18);
    rect(745,y,16,33,12);rect(747,y+2,12,29,22);
  }
  const returningPipe=[[408,391],[408,432],[424,448],[550,448],[566,432],[566,391]];
  chain(returningPipe,12,9);chain(returningPipe,24,5);
  line([424,446],[550,446],40);
  // The short inlet is visibly capped; no continuation leaves the canvas.
  line([267,276],[334,276],12,13);line([267,276],[334,276],24,8);
  disk(267,276,13,12);disk(267,276,10,18);line([263,268],[263,284],34);

  polygon([[326,165],[391,140],[715,140],[650,165]],30);
  polygon([[650,165],[715,140],[715,375],[650,400]],18);
  rect(326,165,324,235,26);
  chain([[326,165],[391,140],[715,140],[715,375],[650,400],[326,400],[326,165]],12,1);
  line([650,165],[650,400],12);line([326,165],[650,165],12);

  // One dark panel seam and small fasteners preserve face readability without
  // introducing a bright plate, a broad top highlight or a second box.
  chain([[349,187],[628,187],[628,378],[349,378],[349,187]],18);
  for(const [x,y]of [[341,181],[635,181],[341,384],[635,384]]){disk(x,y,3,18);dot(x,y,36);}
  line([330,164],[644,164],55);
  line([654,163],[711,142],55);
  rect(372,208,3,2,64);
  return encodeRgbaPng(width,height,rgba);
}

// No file access, provider transport, caller-supplied drawing or memoized state.
// Each call returns independent canonical bytes and their checked fingerprint.
export function sourceVisualGuide(profile){
  check(arguments.length===1&&profile===SOURCE_VISUAL_GUIDE_PROFILE,'SOURCE_VISUAL_GUIDE_PROFILE');
  const bytes=renderGuide();
  return {profile,role:SOURCE_VISUAL_GUIDE_ROLE,bytes,artifact:imageRef(bytes),recipe:SOURCE_VISUAL_GUIDE_RECIPE};
}
