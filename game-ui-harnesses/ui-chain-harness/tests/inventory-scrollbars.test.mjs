import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryScrollbarGeometry,inventoryScrollbarChrome,clampInventoryScroll} from '../src/runtime/inventory-scrollbars.mjs';
const natural=(columns,rows)=>({contentWidth:columns*88+(columns-1)*10,contentHeight:rows*88+(rows-1)*10});
test('12×12 and 32×4 fixed grids retain natural extent and get both reachable skin rail ranges',()=>{
 for(const [columns,rows]of [[12,12],[32,4]]){
  const extent=natural(columns,rows),before=structuredClone(extent),g=inventoryScrollbarGeometry({width:300,height:280,...extent});
  assert(g.x&&g.y);assert.deepEqual(g.viewport,{width:282,height:262});
  assert.deepEqual(g.range,{x:extent.contentWidth-282,y:extent.contentHeight-262});
  assert.deepEqual(clampInventoryScroll({x:-1e9,y:-1e9},g),{x:-g.range.x,y:-g.range.y});
  assert.deepEqual(extent,before);assert(g.iterations<=3);
  assert(g.x.thumbLength<=g.x.width&&g.x.thumbLength>=24);assert(g.y.thumbLength<=g.y.height&&g.y.thumbLength>=24);
 }
});

test('default 5×4 orientation clips have visible axis rails, while 1×1 has none',()=>{
 const landscape=inventoryScrollbarGeometry({width:480,height:330,...natural(5,4)});
 // Y rail consumes width, making X a real overflow too; no hidden last column.
 assert(landscape.y&&landscape.x);assert.deepEqual(landscape.viewport,{width:462,height:312});
 const portrait=inventoryScrollbarGeometry({width:410,height:382,...natural(5,4)});assert(portrait.x&&portrait.y);
 const one=inventoryScrollbarGeometry({width:88,height:88,...natural(1,1)});assert.equal(one.x,null);assert.equal(one.y,null);assert.deepEqual(one.range,{x:0,y:0});
 const roomy=inventoryScrollbarGeometry({width:600,height:500,...natural(5,4)});assert.equal(roomy.x,null);assert.equal(roomy.y,null);
 assert.deepEqual(clampInventoryScroll({x:-200,y:-200},roomy),{x:0,y:0});
});

test('fixed point catches cross-axis overflow in either direction and leaves rails inside original bounds',()=>{
 for(const [contentWidth,contentHeight]of [[299,301],[301,299]]){
  const g=inventoryScrollbarGeometry({width:300,height:300,contentWidth,contentHeight});assert(g.x&&g.y);assert(g.iterations>=2&&g.iterations<=3);
  assert.equal(g.x.y+g.x.height,300);assert.equal(g.y.x+g.y.width,300);
  assert(g.x.x+g.x.width<=g.y.x);assert(g.y.y+g.y.height<=g.x.y);
 }
 const old=inventoryScrollbarGeometry({width:300,height:300,contentWidth:900,contentHeight:900,enabled:false});assert.equal(old.x,null);assert.equal(old.y,null);assert.deepEqual(old.viewport,{width:300,height:300});
 assert.throws(()=>inventoryScrollbarGeometry({width:10,height:10,contentWidth:900,contentHeight:900}),{code:'inventory.scrollbar-geometry'});
});

const chromeLayout=(details,columns=5,rows=4,laneGap=32)=>{
 const naturalSize=natural(columns,rows),below=details==='below',width=below?410:480,height=below?382:330;
 return {grid:{x:23,y:19,width,height,...naturalSize,surface:{x:0,y:0,width:width+46,height:height+39}},details:below?{x:0,y:height+39+laneGap,width:500,height:220,padding:23}:{x:width+46+laneGap,y:0,width:250,height:220,padding:23}};
};

test('dedicated inter-pane rails keep default landscape only Y and portrait only X without shrinking the original viewport',()=>{
 for(const details of ['right','below']){
  const layout=chromeLayout(details),before=structuredClone(layout),g=inventoryScrollbarChrome(layout,{details});
  assert.deepEqual(g.viewport,{x:layout.grid.x,y:layout.grid.y,width:layout.grid.width,height:layout.grid.height});
  if(details==='right'){
   assert.equal(g.x,null);assert.equal(g.y.placement,'gap');assert(g.y.x>=layout.grid.surface.width+4);assert(g.y.x+g.y.width<=layout.details.x-4);
  }else{
   assert.equal(g.y,null);assert.equal(g.x.placement,'gap');assert(g.x.y>=layout.grid.surface.height+4);assert(g.x.y+g.x.height<=layout.details.y-4);
  }
  assert.deepEqual(layout,before);
 }
});

test('large grids still get both axes, and insufficient inter-pane gap falls back to fixed point internal rails',()=>{
 for(const details of ['right','below']){
  const big=chromeLayout(details,12,12),g=inventoryScrollbarChrome(big,{details});assert(g.x&&g.y);
  if(details==='right'){assert.equal(g.y.placement,'gap');assert.equal(g.x.placement,'inside');assert.equal(g.viewport.width,big.grid.width);assert.equal(g.viewport.height,big.grid.height-18);}
  else{assert.equal(g.x.placement,'gap');assert.equal(g.y.placement,'inside');assert.equal(g.viewport.height,big.grid.height);assert.equal(g.viewport.width,big.grid.width-18);}
  const narrow=chromeLayout(details,5,4,17),fallback=inventoryScrollbarChrome(narrow,{details});assert(fallback.x&&fallback.y);assert.equal(fallback.x.placement,'inside');assert.equal(fallback.y.placement,'inside');
 }
});

