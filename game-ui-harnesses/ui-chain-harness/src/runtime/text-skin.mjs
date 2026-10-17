import {textProfile,surfaceTextProfile} from './text-style.mjs';

// Views/resources remain owned by the original skin. Its textStyle producer
// closes over the frozen profile, so replace that method on the node scope.
export function scopedTextSkin(skin,props){
  if(props.fontSize===undefined&&props.textColor===undefined)return skin;
  const scope=Object.create(skin);
  scope.profile=textProfile(skin.profile,props);
  scope.fontSizeOverride=props.fontSize!==undefined;
  scope.textStyle=(extra={})=>({...skin.textStyle(extra),fontSize:scope.profile.fontSize,...(props.textColor!==undefined?{fill:props.textColor}:{})});
  // The deterministic PNG gate derives metrics from the original profile.
  // Never transfer texture/disposal ownership or mutate the verified theme.
  if(skin.assertComponent)scope.assertComponent=(...args)=>skin.assertComponent(...args);
  return scope;
}

// Semantic heading typography belongs to the document presentation contract.
// It must never be injected into an older skin's immutable component props.
// This isolated path also leaves the existing props.fontSize limits unchanged.
export function scopedSurfaceTextSkin(skin,props,surfaceFontSize){
  const scope=scopedTextSkin(skin,props);
  if(surfaceFontSize===undefined)return scope;
  if(!Number.isInteger(surfaceFontSize)||surfaceFontSize<8||surfaceFontSize>96)throw Object.assign(Error('Reference heading font size must be an integer from 8 to 96.'),{code:'skin.surface-style'});
  if(props.fontSize!==undefined)return scope;
  const heading=Object.create(scope);
  heading.profile=surfaceTextProfile(skin.profile,props,surfaceFontSize);
  heading.fontSizeOverride=true;
  heading.textStyle=(extra={})=>({...scope.textStyle(extra),fontSize:surfaceFontSize});
  return heading;
}
