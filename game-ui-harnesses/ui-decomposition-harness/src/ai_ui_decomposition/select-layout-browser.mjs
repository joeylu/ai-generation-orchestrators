// Check actual popup text against registered safe rows, not the full PNG canvas.
export function selectLayoutChecks(node, observed) {
 const a=node.props.appearance,safe=a.popupContentLayout,box=observed.popupBounds;
 const checks=[{slot:'select-layout/open',visible:true,pass:Boolean(observed.popupOpen&&box)}];
 if(!box)return checks;
 const scale=node.layout.width/a.popupCanvas.width;
 const rowHeight=safe.height*scale/node.props.options.length;
 const inside=(r,t)=>r.x>=t.x-.5&&r.y>=t.y-.5&&r.x+r.width<=t.x+t.width+.5&&r.y+r.height<=t.y+t.height+.5;
 node.props.options.forEach((option,index)=>{
  const row=observed.popupItems?.find(r=>r.optionId===option.id);
  const expected={x:box.x+safe.x*scale,y:box.y+safe.y*scale+index*rowHeight,width:safe.width*scale,height:rowHeight};
  checks.push({slot:'select-layout/'+option.id,visible:true,expected,actual:row,
   pass:Boolean(row&&row.text===option.label&&row.textBounds?.some(t=>t.text===option.label)&&row.textBounds.every(t=>t.fontSize===node.props.style.fontSize&&inside(t.bounds,expected))&&(!row.iconBounds||inside(row.iconBounds,expected)))});
 });
 return checks;
}
