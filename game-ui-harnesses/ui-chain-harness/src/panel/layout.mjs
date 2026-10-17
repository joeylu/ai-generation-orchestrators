import Yoga from 'yoga-layout';
import {minimumSize,assertSize} from '../runtime/geometry.mjs';
import {solveLayout,layoutTreeHasRules} from '../runtime/layout.mjs';

// Uses the same solver as the renderer; computed geometry is never serialized.
export function documentLayout(nodes,recipes,parents,profile) {
  const result=new Map();
  const describe=n=>({id:n.id,type:recipes.get(n.id).type,size:n.size,sizing:n.sizing,layout:n.layout,
    position:n.position,visible:n.props.visible,minimum:minimumSize(recipes.get(n.id).type,n.props,profile),
    children:recipes.get(n.id).type==='Container'?(n.slots.children??[]).map(id=>describe(nodes.get(id))):[]});
  for(const n of nodes.values()) {
    const parent=parents.get(n.id)?.node;
    if(parent && recipes.get(parent.id).type==='Container')continue;
    const tree=describe(n);
    if(layoutTreeHasRules(tree))for(const [id,r]of solveLayout(Yoga,tree)){
      const node=nodes.get(id);assertSize(recipes.get(id).type,node.props,profile,r.width,r.height);result.set(id,r);
    }
  }
  return result;
}
