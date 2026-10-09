import { plate, png } from './raster-skin.mjs';
import {raisedSliderPalette,raisedSliderThumb} from './raised-slider.mjs';

/** Owned, deterministic control artwork. Geometry is shared with hit testing. */
export function minimalControlSkin(kind, rect, tokens, radius = 8, pixelScale = 1, grouped = false, sliderStyle) {
  const width = Math.ceil(rect.width * pixelScale), height = Math.ceil(rect.height * pixelScale);
  radius *= pixelScale;
  const raised=kind==='slider'&&sliderStyle==='raised-v1',palette=raised?raisedSliderPalette(tokens.surface):null;
  const key = `generated/${raised?'raised-slider-v1':grouped?'grouped-v1':'minimal-v1'}/${kind}-${width}-${height}-${radius}-${[tokens.control,tokens.border,tokens.accent,...(raised?[palette.edge,palette.track]:[])].map(c=>c.slice(1)).join('-')}`;
  const resources = [];
  const add = (name, bytes) => { const path = `${key}/${name}.png`; resources.push({ path, bytes, mime:'image/png' }); return path; };
  let appearance;
  if (kind === 'input') {
    const backgroundImage = add('field', plate(width,height,radius,[tokens.control,tokens.border]));
    const textLayout = {x:16*pixelScale,y:0,width:width-32*pixelScale,height};
    appearance = { backgroundImage,sourceCanvas:{width,height},textLayout,placeholderLayout:textLayout };
  } else if (kind === 'slider' || kind === 'progress') {
    const slider = kind === 'slider', margin = slider ? (raised?18:14)*pixelScale : 0, trackWidth = width-2*margin, h = (raised?6:grouped?4:6)*pixelScale, y = (height-h)/2;
    const trackColor=raised?palette.track:tokens.border;
    const trackImage=add('track',plate(trackWidth,h,3*pixelScale,[trackColor,trackColor]));
    const fillImage=add('fill',plate(trackWidth,h,3*pixelScale,[tokens.accent,tokens.accent]));
    const layout={x:margin,y,width:trackWidth,height:h};
    appearance={sourceCanvas:{width,height},track:{image:trackImage,canvas:{width:trackWidth,height:h},layout},
      fill:{image:fillImage,canvas:{width:trackWidth,height:h},layout},fillClip:layout,fillDirection:'left-to-right',fillSource:'full-range-template'};
    const thumb=grouped?28:18;
    if(raised)Object.assign(appearance,{thumbImage:add('thumb',raisedSliderThumb(pixelScale,palette)),thumbCanvas:{width:36*pixelScale,height:36*pixelScale},
      thumbPositions:{min:{x:margin-18*pixelScale,y:height/2-16*pixelScale},max:{x:width-margin-18*pixelScale,y:height/2-16*pixelScale}}});
    else if(slider) Object.assign(appearance,{thumbImage:add('thumb',plate(thumb*pixelScale,thumb*pixelScale,thumb/2*pixelScale,[grouped?'#FFFFFF':'#F5FCFA',grouped?'#D1D1D6':tokens.accent])),thumbCanvas:{width:thumb*pixelScale,height:thumb*pixelScale},
      thumbPositions:{min:{x:margin-thumb/2*pixelScale,y:(height-thumb*pixelScale)/2},max:{x:width-margin-thumb/2*pixelScale,y:(height-thumb*pixelScale)/2}}});
  } else if (kind === 'switch') {
    const trackWidth=(grouped?52:48)*pixelScale,trackHeight=(grouped?32:28)*pixelScale,x=(width-trackWidth)/2,y=(height-trackHeight)/2;
    const track = color => png(width,height,[color],(px,py)=>{
      let count=0;
      for(const dx of [.25,.75])for(const dy of [.25,.75]) {
        const a=px+dx-x,b=py+dy-y;
        if(a>=0&&a<trackWidth&&b>=0&&b<trackHeight&&Math.hypot(Math.max(trackHeight/2-a,0,a-(trackWidth-trackHeight/2)),b-trackHeight/2)<=trackHeight/2)count++;
      }
      return count;
    });
    const off=add('off',track(tokens.border)),on=add('on',track(grouped?'#34C759':tokens.accent));
    const thumb=grouped?28:20,pad=grouped?2:4;
    const thumbImage=add('thumb',plate(thumb*pixelScale,thumb*pixelScale,thumb/2*pixelScale,[grouped?'#FFFFFF':'#F5FCFA',grouped?'#FFFFFF':'#F5FCFA']));
    appearance={trackImage:off,thumbImage,sourceCanvas:{width,height},thumbPositions:{off:{x:x+pad*pixelScale,y:y+pad*pixelScale},on:{x:x+trackWidth-(thumb+pad)*pixelScale,y:y+pad*pixelScale}},
      stateImages:{version:'1.0',off:{trackImage:off,thumbImage},on:{trackImage:on,thumbImage}}};
  } else throw new Error('MINIMAL_SKIN_KIND');
  return { resources,appearance };
}
