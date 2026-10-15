// Frozen consumer configuration decides the visual generation. Loading an old
// run never opts into today's panel/card composition defaults.
export function layeredConsumer(config,presetId){
 if(presetId==='inventory')return config.inventoryPlanning?.version==='1.2';
 if(presetId==='custom')return config.presets?.custom?.layout?.version==='3.0';
 return config.presentation?.version==='2.0';
}
export function compilationSurfaceVersion(config,presetId,ctx={}){
 if(ctx.surfaceStylesEnabled===false)return 0;
 return ctx.surfaceLayersEnabled!==false&&layeredConsumer(config,presetId)?2:1;
}
export function surfaceCompileContext(ctx,version){
 if(![0,1,2].includes(version))throw Object.assign(Error('Unsupported surface recipe version.'),{code:'SURFACE_RECIPES_VERSION'});
 return {...ctx,surfaceStylesEnabled:version>=1,surfaceLayersEnabled:version>=2};
}
