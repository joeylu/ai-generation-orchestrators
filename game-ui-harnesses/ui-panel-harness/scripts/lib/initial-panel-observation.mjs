import {controlId} from '../../src/compiler.mjs';
/** Record clipping before focus navigation can scroll a control into view. No quality inference. */
export function observeInitialPanel(bundle,inspection,state=bundle.state){
  const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],spec=bundle.spec;
  const documentNodes=flatten(bundle.componentBundle.document.root),rendered=new Map(inspection.nodes.map(node=>[node.id,node]));
  const panel=rendered.get(spec.id+'.panel'),activePage=spec.tabs?.pages.find(page=>page.id===state[spec.tabs.bind]);
  const sections=spec.sections.filter(section=>!spec.tabs||activePage?.sections.includes(section.id));
  const headingIds=new Set(sections.map(section=>spec.id+'.section.'+section.id+'.title'));
  const outside=(box,area)=>box.x<area.x-1||box.y<area.y-1||box.x+box.width>area.x+area.width+1||box.y+box.height>area.y+area.height+1;
  const buttons=sections.flatMap(section=>section.rows.filter(row=>row.kind==='button').map(row=>{
    const id=controlId(spec.id,row.id),bounds=rendered.get(id)?.bounds,issues=[];
    const bodyId=spec.tabs?spec.id+'.page.'+activePage.id:spec.id+'.body';
    const clipNodes=[panel,...documentNodes.filter(node=>node.type==='ScrollView'&&node.id===bodyId).map(node=>rendered.get(node.id))].filter(Boolean);
    if(!bounds||bounds.width<=0||bounds.height<=0)issues.push('MISSING_RENDER_BOUNDS');
    else{
      if(outside(bounds,{x:0,y:0,width:spec.canvas.width,height:spec.canvas.height}))issues.push('CANVAS_CLIPPING');
      for(const node of clipNodes)if(node.bounds&&outside(bounds,node.bounds))issues.push('CLIPPED_BY:'+node.id);
    }
    return {id,label:row.buttonLabel,enabled:row.enabled,bounds:bounds??null,fullyInsideClipRegions:issues.length===0,issues};
  }));
  return {kind:'INITIAL_RENDER_OBSERVATIONS_NOT_CONTENT_QUALITY',activePage:activePage?.id??null,canvas:spec.canvas,
    headings:inspection.nodes.filter(node=>headingIds.has(node.id)).map(node=>({id:node.id,bounds:node.bounds??null})),
    buttons,clippedButtons:buttons.filter(button=>!button.fullyInsideClipRegions).map(button=>button.id),
    scrollViews:documentNodes.filter(node=>node.type==='ScrollView').map(node=>({id:node.id,height:node.layout.height,contentHeight:node.props.contentHeight}))};
}
