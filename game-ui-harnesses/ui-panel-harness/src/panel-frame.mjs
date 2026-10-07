/** Fixed logical panel geometry. Canvas is a surrounding preview/export surface. */
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function checkPanelFrame(frame,fail,path='$.frame') {
  if(frame===null)return;
  if(!exact(frame,['width','height']))fail('panel-frame-fields',path,'width and height required');
  if(!Number.isSafeInteger(frame.width)||frame.width<1||frame.width>4096||typeof frame.height!=='number'||!Number.isFinite(frame.height)||frame.height<1||frame.height>4096)fail('panel-frame-size',path,'integer width and finite height in 1..4096 required');
}
export function ratioPanelFrame(spec,ratio,width,fail,path) {
  if(!exact(ratio,['width','height'])||!['width','height'].every(key=>Number.isSafeInteger(ratio[key])&&ratio[key]>=1&&ratio[key]<=1000))fail('panel-ratio',path+'.ratio','positive integer ratio terms in 1..1000 required');
  if(width!==null&&(!Number.isSafeInteger(width)||width<1||width>4096))fail('panel-frame-size',path+'.width','null or integer width in 1..4096 required');
  const frame={width:width??spec.layout.width,height:(width??spec.layout.width)*ratio.height/ratio.width};checkPanelFrame(frame,fail,path+'.frame');return frame;
}
export function applyPanelFrame(spec,frame) {
  spec.frame=frame;
  if(frame===null)return;
  spec.layout.width=frame.width;spec.layout.maxHeight=Math.ceil(frame.height);
  const fields=new Map(spec.state.map(field=>[field.id,field]));
  const popup=Math.max(0,...spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='select').map(row=>40*fields.get(row.bind).options.length+2));
  spec.canvas={width:Math.min(4096,frame.width+64),height:Math.min(4096,Math.ceil(frame.height)+64+popup*2)};
}
