import {textProfile} from './text-style.mjs';

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
