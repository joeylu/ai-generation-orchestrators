// Frozen consumer configuration decides the visual generation. Loading an old
// run never opts into today's panel/card composition defaults.
export function layeredConsumer(config,presetId){
 if(presetId==='inventory')return ['1.2','1.3','1.4'].includes(config.inventoryPlanning?.version);
 if(presetId==='custom')return ['3.0','4.0'].includes(config.presets?.custom?.layout?.version);
 return ['2.0','3.0'].includes(config.presentation?.version);
}
export function referenceConsumer(config,presetId){return presetId==='inventory'?['1.3','1.4'].includes(config.inventoryPlanning?.version):presetId==='custom'?config.presets?.custom?.layout?.version==='4.0':config.presentation?.version==='3.0';}
export function compilationSurfaceVersion(config,presetId,ctx={}){
 if(ctx.surfaceStylesEnabled===false)return 0;
 return ctx.surfaceLayersEnabled!==false&&layeredConsumer(config,presetId)?referenceConsumer(config,presetId)?3:2:1;
}
export function surfaceCompileContext(ctx,version){
 if(![0,1,2,3].includes(version))throw Object.assign(Error('Unsupported surface recipe version.'),{code:'SURFACE_RECIPES_VERSION'});
 return {...ctx,surfaceStylesEnabled:version>=1,surfaceLayersEnabled:version>=2,surfaceCompositionEnabled:version>=3};
}
