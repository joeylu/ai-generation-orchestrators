// Chain preset geometry, not the upstream PanelSpec compiler or font measurement.
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function presentation(config){
  if(config===undefined)return {titleAlign:'left',sectionHeading:'show',height:'fixed',canvasMargin:0};
  if(config.version!=='1.0'||Object.keys(config).some(k=>!['version','titleAlign','sectionHeading','height','canvasMargin'].includes(k))||!['left','center','right'].includes(config.titleAlign)||!['show','auto-single'].includes(config.sectionHeading)||!['fixed','grow'].includes(config.height)||!Number.isInteger(config.canvasMargin)||config.canvasMargin<0)fail('panel.presentation');
  return config;
}
export function presetHeight({policy,width,height,board,padding,children,gap}){
  const required=padding*2+children.reduce((sum,n)=>sum+n,0)+Math.max(0,children.length-1)*gap;
  const target=policy.height==='grow'?Math.max(height,Math.ceil(required)):height;
  if(width>board.width-policy.canvasMargin*2||target>board.height-policy.canvasMargin*2)fail('panel.canvas-capacity');
  return target;
}
