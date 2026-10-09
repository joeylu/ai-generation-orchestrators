export function buttonLineChecks(node,observed,bounds,scale=1) {
 const lines=node.props.appearance?.labelLines?.lines;if(!lines)return [];
 const actual=observed.renderedTextBounds??[],cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
 const checks=[{slot:'button-lines/count',visible:true,pass:actual.length===lines.length,actual:actual.length}];
 lines.forEach((line,index)=>{
  const text=actual[index],r=line.layout;
  const box={x:cx+(bounds.x+r.x-cx)*scale,y:cy+(bounds.y+r.y-cy)*scale,width:r.width*scale,height:r.height*scale};
  const t=text?.bounds;
  const aligned=t&&(line.align==='center'?Math.abs((t.x+t.width/2)-(box.x+box.width/2))<.7:line.align==='right'?Math.abs(t.x+t.width-box.x-box.width)<.7:Math.abs(t.x-box.x)<.7);
  checks.push({slot:`button-lines/${index}`,visible:true,expected:box,actual:text,pass:Boolean(observed.visible&&t&&text.text===line.text&&text.fontFamily===node.props.style.fontFamily&&text.fontSize===line.fontSize&&aligned&&t.x>=box.x-.7&&t.y>=box.y-.7&&t.x+t.width<=box.x+box.width+.7&&t.y+t.height<=box.y+box.height+.7)});
 });return checks;
}
