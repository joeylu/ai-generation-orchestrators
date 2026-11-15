export function supportsModuleRenderStyle(module,kitFormat){
  const style=module.renderStyle,scale=style?.scale?.numerator/style?.scale?.denominator;
  return scale>=.125&&scale<=4&&(module.kind==='environment'
    ||kitFormat==='ai_scene_kit_v4'&&module.kind==='background'&&style.opacity===1&&style.tint===0xffffff);
}
