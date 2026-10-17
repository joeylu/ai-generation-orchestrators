// Project the shared logical body into editor view space. The supplied origin
// comes from the rendered handle, including ancestor positions/scroll offsets.
export function panelBodyFrames(targets,selected,origin,scale){
 const target=targets.find(item=>item.id===selected);if(!target)return [];
 const parent=targets.find(item=>item.id===target.parentId),result=[];
 for(const[key,item]of [['self',target],['parent',parent]]){
  if(!item?.body)continue;const box=item.body,point=origin(item.id,{x:box.x,y:box.y});
  if(!point||![point.x,point.y,box.width,box.height,scale].every(Number.isFinite)||scale<=0||box.width<0||box.height<0)continue;
  result.push({key,nodeId:item.id,body:box,rect:{x:point.x*scale,y:point.y*scale,width:box.width*scale,height:box.height*scale}});
 }
 return result;
}
