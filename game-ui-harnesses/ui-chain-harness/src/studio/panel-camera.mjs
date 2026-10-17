const modes=new Set(['fit','focus','manual']);
const fail=field=>{throw Object.assign(new TypeError(`Invalid camera ${field}.`),{code:'studio.camera'});};
const finite=(value,field)=>{if(!Number.isFinite(value))fail(field);return value;};
const positive=(value,field)=>{if(finite(value,field)<=0)fail(field);return value;};
const viewport=value=>{
  if(!value||typeof value!=='object')fail('viewport');
  positive(value.width,'viewport.width');positive(value.height,'viewport.height');
  return value;
};
const camera=value=>{
  if(!value||typeof value!=='object')fail('state');
  finite(value.x,'x');finite(value.y,'y');positive(value.scale,'scale');
  if(!modes.has(value.mode))fail('mode');
  return value;
};
const result=(x,y,scale,mode)=>camera({x,y,scale,mode});

// Camera x/y and zoom anchors use viewport pixels; authoring rectangles use
// logical pixels. Fitting never changes the underlying document.
export function frameCamera(rect,view,{padding=40,maxScale=2.5,minScale=.1,mode='focus'}={}){
  viewport(view);
  if(!rect||typeof rect!=='object')fail('rectangle');
  finite(rect.x,'rectangle.x');finite(rect.y,'rectangle.y');
  positive(rect.width,'rectangle.width');positive(rect.height,'rectangle.height');
  if(finite(padding,'padding')<0)fail('padding');
  positive(minScale,'minScale');positive(maxScale,'maxScale');
  if(minScale>maxScale)fail('scale range');
  if(!modes.has(mode))fail('mode');
  // Reduce padding independently on narrow axes, retaining at least half the
  // viewport as fitting space. minScale may still require deliberate overflow.
  const width=view.width-Math.min(padding,view.width/4)*2;
  const height=view.height-Math.min(padding,view.height/4)*2;
  const scale=Math.max(minScale,Math.min(maxScale,width/rect.width,height/rect.height));
  return result(view.width/2-(rect.x+rect.width/2)*scale,view.height/2-(rect.y+rect.height/2)*scale,scale,mode);
}

// Keep the logical point underneath this viewport-local anchor stationary.
export function zoomCamera(input,nextScale,anchor){
  camera(input);positive(nextScale,'nextScale');
  if(!anchor||typeof anchor!=='object')fail('anchor');
  finite(anchor.x,'anchor.x');finite(anchor.y,'anchor.y');
  const scale=Math.max(.1,Math.min(2.5,nextScale));
  return result(anchor.x-(anchor.x-input.x)*scale/input.scale,anchor.y-(anchor.y-input.y)*scale/input.scale,scale,'manual');
}

export function panCamera(input,dx,dy){
  camera(input);finite(dx,'dx');finite(dy,'dy');
  return result(input.x+dx,input.y+dy,input.scale,'manual');
}

// Fit/focus modes are reframed by the caller using their chosen authoring rect.
// Only a manually positioned camera preserves its previous center on resize.
export function resizeCamera(input,previousViewport,nextViewport){
  camera(input);viewport(previousViewport);viewport(nextViewport);
  if(input.mode!=='manual')return {...input};
  return result(input.x+(nextViewport.width-previousViewport.width)/2,input.y+(nextViewport.height-previousViewport.height)/2,input.scale,'manual');
}
