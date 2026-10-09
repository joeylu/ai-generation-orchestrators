import assert from 'node:assert/strict';
/** Gate the local refinement to sliders; all authored layout, assets, palette and business stay exact. */
export function assertSliderClarityStudy(before,after) {
  assert.equal(before.compilerVersion,'0.22.0');assert.equal(after.compilerVersion,'0.23.0');
  for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual({...after.spec,theme:before.spec.theme},before.spec);
  assert.deepEqual({...after.catalog,id:before.catalog.id,themes:before.catalog.themes},before.catalog);
  assert.equal(after.catalog.themes.length,1);
  const theme=after.catalog.themes[0],old=before.catalog.themes[0],{sliderStyle,...rest}=theme;
  assert.equal(sliderStyle,'raised-v1');assert.deepEqual({...rest,version:old.version},old);
  const own=node=>({...node,...(node.children?{children:node.children.map(child=>child.id)}:{})});
  const flatten=node=>[own(node),...(node.children??[]).flatMap(flatten)];
  const previous=flatten(before.componentBundle.document.root),next=flatten(after.componentBundle.document.root);
  assert.equal(previous.length,next.length);
  for(const [index,node] of next.entries()){
    const old=previous[index];
    assert.deepEqual(node.type==='Slider'?{...node,props:{...node.props,appearance:old.props.appearance}}:node,old);
  }
}
