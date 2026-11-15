import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTerrainStepCornerProfile,compileTerrainStepCorners,TERRAIN_STEP_CORNER_PROFILE} from '../src/terrain-step-corners.mjs';

const appearance={format:'ai_scene_continuous_terrain_appearance_v7',bodyPeriod:{width:{numerator:512,denominator:1},height:{numerator:124416,denominator:253}},
  capDepth:{numerator:36,denominator:1},capUvEnd:{numerator:1,denominator:1}},profile=buildTerrainStepCornerProfile({widthWorld:32,heightWorld:12}),
  world={x:0,y:0,width:640,height:512},grid={width:64,height:64};
function fixture(){
  const cells=new Map();for(let y=2;y<5;y++)for(let x=2;x<7;x++)cells.set(`${x},${y}`,'primary');
  for(let x=3;x<6;x++)cells.set(`${x},1`,'primary');
  const source={gridCells:[...cells.keys()].map(k=>{const [x,y]=k.split(',').map(Number);return {x,y};})},owner={gridTerrainId:'grid-field/3,1',layerId:'terrain',source,
    body:{positions:[128,128,128,320,448,128,448,320],uvs:[0,0,0,1,1,0,1,1],indices:[0,1,2,2,1,3]},cap:{positions:[],uvs:[],indices:[]},
    capBands:[],edgeMeshes:[],bounds:{x:128,y:64,width:320,height:256},unionMaterial:{group:0}};
  const north=[{from:{x:128,y:128},to:{x:192,y:128},ownerId:owner.gridTerrainId},{from:{x:192,y:64},to:{x:384,y:64},ownerId:owner.gridTerrainId},
    {from:{x:384,y:128},to:{x:448,y:128},ownerId:owner.gridTerrainId}];
  return {gridTerrains:[owner],curveTerrains:[],edgePlacement:{placed:[{side:'left',x:192,fromY:64,toY:128,ownerIds:[owner.gridTerrainId]},
    {side:'right',x:384,fromY:64,toY:128,ownerIds:[owner.gridTerrainId]}]},unionMaterial:{groups:[{ownerIds:[owner.gridTerrainId],exposedNorthSegments:north}]},appearance,profile,world,cells,grid};
}
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(e=>e.code===code));

test('both real concave step orientations receive a bounded source ramp while original owner data stays unchanged',()=>{
  const input=fixture(),before=structuredClone(input),result=compileTerrainStepCorners(input);
  assert.deepEqual(input,before);assert.equal(result.report.placed.length,2);assert.equal(result.report.skipped.length,0);
  assert.equal(result.report.profile.profile,TERRAIN_STEP_CORNER_PROFILE);assert.equal(result.report.authorGeometryChanged,false);assert.equal(result.report.collisionChanged,false);
  assert.deepEqual(result.gridTerrains[0].body,before.gridTerrains[0].body);assert.deepEqual(result.gridTerrains[0].source,before.gridTerrains[0].source);
  assert.deepEqual(result.gridTerrains[0].edgeMeshes,before.gridTerrains[0].edgeMeshes);assert.equal(result.report.capEndFadeWorld,8);
  for(const placed of result.report.placed){assert.equal(placed.widthWorld,32);assert.equal(placed.heightWorld,12);assert.equal(placed.samples.length,17);
    assert.equal(placed.samples[0].y,128);assert.equal(placed.samples.at(-1).y,116);}
});

test('ramp body keeps exact physical world material phase and occupies only the new air wedge',()=>{
  const result=compileTerrainStepCorners(fixture()),periodY=124416/253,body=result.gridTerrains[0].cornerMeshes.filter(m=>m.materialKind==='body');
  assert.equal(body.length,2);for(const m of body){assert.equal(m.coverageOpacity,1);
    for(let i=0;i<m.positions.length;i+=2){assert.equal(m.uvs[i],m.positions[i]/512);assert.equal(m.uvs[i+1],m.positions[i+1]/periodY);
      assert(m.positions[i+1]>=116&&m.positions[i+1]<=128);}
  }
  assert.equal(result.report.bodyCoordinates,'fixed-world-physical-material-period');assert.equal(result.report.sourcePngChanged,false);
});

test('local cap uses original vertical source rows and explicit end and bottom source-over coverage without source edits',()=>{
  const result=compileTerrainStepCorners(fixture()),bands=result.gridTerrains[0].cornerMeshes.filter(m=>m.materialKind==='cap');
  assert.equal(bands.length,2*20*25);assert(bands.some(m=>m.coverageOpacity===1));assert(bands.some(m=>m.capWallEndCoverage<1));
  assert(bands.some(m=>m.capBottomCoverage<1));
  for(const m of bands){assert(m.coverageOpacity>0&&m.coverageOpacity<=1);assert.equal(m.sourcePngChanged,false);
    assert.equal(m.coverageOpacity,m.capBottomCoverage*m.capWallEndCoverage);
    for(let i=0;i<m.positions.length;i+=2){assert.equal(m.uvs[i],m.positions[i]/512);assert(m.uvs[i+1]>=0&&m.uvs[i+1]<=1);
      const expected=(i/2)%2?m.sourceLocalDepth.toWorld/36:m.sourceLocalDepth.fromWorld/36;assert.equal(m.uvs[i+1],expected);}
  }
});

test('convex ends, detached groups, curved ledges and world boundaries never acquire a false inner-corner ramp',()=>{
  let input=fixture();input.edgePlacement.placed[0].toY=96;input.edgePlacement.placed[1].ownerIds=['different'];
  assert.equal(compileTerrainStepCorners(input).report.placed.length,0);
  input=fixture();input.unionMaterial.groups[0].exposedNorthSegments[0].from.y=127;input.unionMaterial.groups[0].exposedNorthSegments[2].to.y=129;
  assert.equal(compileTerrainStepCorners(input).report.placed.length,0);
  input=fixture();input.world={x:175,y:120,width:220,height:200};const result=compileTerrainStepCorners(input);
  assert.equal(result.report.placed.length,0);assert(result.report.skipped.every(s=>s.reason==='world-boundary'));
});

test('occupied headroom or missing cap-depth support rejects a corner rather than filling another solid or air below',()=>{
  let input=fixture();input.cells.set('2,1','ceiling');input.cells.set('6,1','ceiling');
  let result=compileTerrainStepCorners(input);assert.equal(result.report.placed.length,0);
  assert(result.report.skipped.every(s=>s.reason==='blocked-headroom-or-missing-solid-support'||s.reason==='occupied-visual-wedge'||s.reason==='occupied-air-rectangle'));
  input=fixture();input.cells.delete('2,2');input.cells.delete('6,2');
  // Thin curve support meets the ledge top but ends before the whole source cap.
  input.curveTerrains=[{curveId:'thin.left',surface:[{x:128,y:128},{x:192,y:128}],bounds:{x:128,y:128,width:64,height:16}},
    {curveId:'thin.right',surface:[{x:384,y:128},{x:448,y:128}],bounds:{x:384,y:128,width:64,height:16}}];
  result=compileTerrainStepCorners(input);assert.equal(result.report.placed.length,0);assert(result.report.skipped.every(s=>s.reason==='unsupported-cap-depth'));
});

test('a thin ceiling between projection columns blocks the conservative air rectangle instead of being crossed',()=>{
  const input=fixture();input.curveTerrains=[{curveId:'thin.ceiling',surface:[{x:180.2,y:126.6},{x:180.8,y:126.6}],bounds:{x:180.2,y:126.6,width:.6,height:.2}}];
  const result=compileTerrainStepCorners(input);assert.equal(result.report.placed.length,1);
  assert.equal(result.report.placed[0].side,'right');assert.deepEqual(result.report.skipped.map(s=>s.reason),['occupied-air-rectangle']);
});

test('the cap fades eight world units onto the real same-group wall while the new body ends at the logical wall',()=>{
  const input=fixture(),result=compileTerrainStepCorners(input),placed=result.report.placed.find(c=>c.side==='left'),
    meshes=result.gridTerrains[0].cornerMeshes.filter(m=>m.cornerId===placed.cornerId),body=meshes.find(m=>m.materialKind==='body'),cap=meshes.filter(m=>m.materialKind==='cap');
  assert.equal(result.report.capWallOverlapWorld,8);assert.equal(placed.wallOverlapExtent.right,200);assert.equal(placed.capExtent.right,200);
  assert.equal(Math.max(...body.positions.filter((_,i)=>i%2===0)),192);
  assert.equal(Math.max(...cap.flatMap(m=>m.positions.filter((_,i)=>i%2===0))),200);
  assert(cap.filter(m=>m.positions[0]<192&&m.positions[4]<=192).every(m=>m.capWallEndCoverage===1),'air ramp must not fade before reaching its rock support');
  assert(cap.some(m=>m.positions[0]>=192&&m.capWallEndCoverage<1));assert.equal(result.report.sourceAlphaChanged,false);
  const missing=fixture();missing.gridTerrains[0].source.gridCells=missing.gridTerrains[0].source.gridCells.filter(c=>!(c.x===3&&c.y===1));
  const rejected=compileTerrainStepCorners(missing);assert.equal(rejected.report.placed.length,1);assert.equal(rejected.report.placed[0].side,'right');
  assert(rejected.report.skipped.some(c=>c.side==='left'&&c.reason==='unsupported-wall-overlap-same-group'),'unrelated allCells support must not certify this group overlap');
});

test('profile closure, deterministic results and owner budgets are enforced without returning partial geometry',()=>{
  const input=fixture();assert.deepEqual(compileTerrainStepCorners(input),compileTerrainStepCorners(input));
  rejects(()=>buildTerrainStepCornerProfile({widthWorld:32,heightWorld:25}),'STEP_CORNER_PROFILE');
  rejects(()=>buildTerrainStepCornerProfile({widthWorld:32,heightWorld:12,extra:1}),'STEP_CORNER_OPTIONS');
  const many=Array.from({length:2049},(_,i)=>({...input.gridTerrains[0],gridTerrainId:`owner.${i}`}));
  rejects(()=>compileTerrainStepCorners({...input,gridTerrains:many}),'STEP_CORNER_BUDGET');
});
