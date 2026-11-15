import test from 'node:test';
import assert from 'node:assert/strict';
import {environmentPlacement,groupSceneLayers,layerGroupRole,sceneLayerRows} from '../src/studio/layer-groups.mjs';
import {paletteAssetRoles} from '../src/studio/palette-groups.mjs';
import {placementLayer} from '../src/studio/preset-placement.mjs';
import {generatedEnvironmentId} from '../src/studio/generated-environment-id.mjs';
import {createEditor} from '../src/editor.mjs';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {fixtureRoot} from './helpers/generation.mjs';

const layer = (layerId,kind,x,zIndex) => ({layerId,kind,parallax:{x,y:1},zIndex,visible:true});
const item = (instanceId,layerId,assetId='marker') => ({instanceId,layerId,assetId});
const map = (layers,instances=[]) => ({layers,instances,assemblyInstances:[],terrainRuns:[],curveTerrains:[]});

test('flat draw-stack diagnostic keeps mixed and empty layers in their actual slots', () => {
  const document=map([
    layer('far.high','background',.2,50),layer('props','environment',1,30),
    layer('ground','terrain',1,20),layer('empty','environment',.2,40),layer('far.low','background',.3,10),
  ],[item('a','props'),item('z','props','terrain-shell'),item('high','far.high'),item('low','far.low')]);
  document.curveTerrains=[{curveId:'curve.one'}];document.terrainRuns=[{length:3}];
  const before=structuredClone(document),rows=sceneLayerRows(document);
  assert.deepEqual(rows.map(row=>row.layer.layerId),['far.high','empty','props','ground','far.low']);
  assert.deepEqual(rows[2].items.map(item=>item.instanceId),['z','a']);
  assert.equal(rows.filter(row=>row.layer.layerId==='props').length,1);
  assert.equal(rows[3].brushCells,3);assert.deepEqual(rows[3].items,document.curveTerrains);
  assert.deepEqual(document,before);
});

test('full-stack order crosses content categories without altering geometry and survives undo and reopen', () => {
  const kit=loadSceneKit(fixtureRoot),document=readMap(kit);document.inspectionCases=[];
  const editor=createEditor(kit,document),before=editor.getDocument(),ids=sceneLayerRows(before).map(row=>row.layer.layerId);
  const order=[ids[1],ids[0],ids[2]],command={type:'reorder-layers',layerIds:order};
  assert.equal(editor.execute([command]).changed,true);
  const after=editor.getDocument();
  assert.deepEqual(editor.getScene().layers.map(layer=>layer.layerId),order.toReversed());
  assert.deepEqual(after.instances,before.instances);assert.deepEqual(after.assemblyInstances,before.assemblyInstances);
  assert.deepEqual(after.terrainRuns,before.terrainRuns);
  assert.deepEqual(after.layers.map(layer=>layer.zIndex),before.layers.map(layer=>layer.zIndex));
  for(const layer of after.layers)assert.deepEqual({...layer,zIndex:0},{...before.layers.find(l=>l.layerId===layer.layerId),zIndex:0});
  assert.equal(editor.execute([command]).changed,false);
  for(const layerIds of [[ids[0],ids[0],ids[2]],[ids[0],ids[1],'missing'],[ids[0],ids[1]]]) {
    assert.throws(()=>editor.execute([{type:'reorder-layers',layerIds}]));assert.deepEqual(editor.getDocument(),after);
  }
  assert.equal(editor.undo().changed,true);assert.deepEqual(editor.getDocument(),before);
  assert.equal(editor.redo().changed,true);assert.deepEqual(editor.getDocument(),after);
  assert.deepEqual(createEditor(kit,JSON.parse(editor.serialize())).getDocument(),after);
});

test('one layer can reorder a terrain-bearing assembly and scenery together without splitting its visual stack', () => {
  const kit=loadSceneKit(fixtureRoot),document=readMap(kit);document.inspectionCases=[];
  const editor=createEditor(kit,document),order=['marker.main','pair.main'];
  assert.equal(editor.execute([{type:'reorder-layer-objects',layerId:'environment',instanceIds:order}]).changed,true);
  assert.deepEqual(sceneLayerRows(editor.getDocument()).find(row=>row.layer.layerId==='environment').items.map(item=>item.instanceId),order);
  assert.deepEqual(editor.getScene().layers.find(layer=>layer.layerId==='environment').nodes.map(node=>node.nodeId),
    ['visual/pair.main/left/marker','visual/pair.main/right/marker','visual/marker.main']);
});

test('platform groups brush cells and curves apart from placed scenery and keeps empty layers available', () => {
  const document=map([
    layer('sky','background',0,0),layer('hills','background',.15,10),layer('unused','environment',.3,15),
    layer('ground','terrain',1,20),layer('props','environment',1,30),layer('front','environment',1.1,40),
  ],[item('sky','sky'),item('hill','hills'),item('decor','props'),item('ledge','props','terrain-shell'),item('frame','front')]);
  document.terrainRuns=[{length:4},{length:6}];
  document.curveTerrains=[{curveId:'curve.one'}];
  const before=structuredClone(document);
  const groups=groupSceneLayers(document,{modules:[{assetId:'terrain-shell',terrainSkin:{}}]});
  assert.deepEqual(groups.map(g=>g.label),['前景','平台','远景','背景','空图层']);
  const [terrain,environment]=groups.find(g=>g.role==='platform').children;
  assert.deepEqual(terrain.rows.map(r=>[r.layer.layerId,r.split,r.brushCells]),[['props',true,undefined],['ground',false,10]]);
  assert.deepEqual(terrain.rows.map(r=>r.items),[[item('ledge','props','terrain-shell')],[{curveId:'curve.one'}]]);
  assert.deepEqual(environment.rows.map(r=>[r.layer.layerId,r.split,r.items]),[['props',true,[item('decor','props')]]]);
  assert.deepEqual(groups.find(g=>g.role==='far').rows.map(r=>r.layer.layerId),['hills']);
  assert.deepEqual(groups.find(g=>g.role==='empty').rows.map(r=>r.layer.layerId),['unused']);
  assert.deepEqual(document,before);
});

test('unpainted terrain keeps its brush entry and only placed terrain presets move into that section', () => {
  const document=map([layer('ground','terrain',1,10),layer('visuals','environment',1,20),layer('unused','environment',1,30)]);
  document.assemblyInstances=[{instanceId:'bridge',layerId:'visuals',presetId:'terrain-piece'},{instanceId:'cluster',layerId:'visuals',presetId:'scenery-piece'}];
  const groups=groupSceneLayers(document,{modules:[{assetId:'available-only',terrainSkin:{},preferredLayerId:'unused'}],presets:[{presetId:'terrain-piece',hasTerrain:true}]});
  const [terrain,environment]=groups[0].children;
  assert.deepEqual(terrain.rows.map(r=>r.brushCells),[undefined,0]);
  assert.equal(terrain.rows[0].items[0].instanceId,'bridge');
  assert.equal(environment.rows[0].items[0].instanceId,'cluster');
  assert.equal(groups[1].rows[0].layer.layerId,'unused');
});

test('depth groups merge interleaved layers and preserve z-order within each group', () => {
  const layers=[layer('far.one','background',.2,0),layer('props','environment',.6,10),layer('far.two','background',.3,20)];
  const groups=groupSceneLayers(map(layers,layers.map(l=>item(l.layerId,l.layerId))));
  assert.deepEqual(groups.map(g=>g.label),['中景','远景']);
  assert.deepEqual(groups[1].rows.map(r=>r.layer.layerId),['far.two','far.one']);
  assert.deepEqual(groupSceneLayers(map([])),[]);
  const cases=[['cave.backdrop','background',0,'background'],['dune.ruins','environment',.3,'far'],['stone.floor','terrain',1,'terrain'],['snow.ledge','environment',1,'main'],['canopy','foreground',1.15,'foreground'],['constructor','environment',.65,'middle']];
  for(const [id,kind,x,role] of cases)assert.equal(layerGroupRole(layer(id,kind,x,0)),role);
});

test('library roles follow placed assets and retain a single group when a source is shared', () => {
  const document=map([layer('far','background',.2,10),layer('main','environment',1,20),layer('foreground','environment',1.1,30)], [
    item('moved','main','arch'),item('bank.a','far','bank'),item('bank.b','foreground','bank'),
  ]);
  document.assemblyInstances=[{instanceId:'cluster.a',layerId:'far',presetId:'cluster'}];
  const role=paletteAssetRoles(document);
  assert.equal(role('module',{assetId:'arch',kind:'environment',preferredLayerId:'far'}),'environment');
  assert.equal(role('module',{assetId:'bank',kind:'environment',preferredLayerId:'far'}),'far');
  assert.equal(role('module',{assetId:'bank',kind:'environment',preferredLayerId:'missing'}),'foreground');
  assert.equal(role('module',{assetId:'sky',kind:'background'}),'background');
  assert.equal(role('module',{assetId:'unused',kind:'environment',preferredLayerId:'far'}),'far');
  assert.equal(role('module',{assetId:'arch',kind:'environment',terrainSkin:{}}),'terrain');
  assert.equal(role('preset',{presetId:'cluster'}),'far');
  assert.equal(role('preset',{presetId:'cluster',hasTerrain:true}),'terrain');
});

test('generated scenery has an environment card and uses the main layer by default', () => {
  const asset = { assetId: generatedEnvironmentId('bdb66809-eacb-4f5b-9b91-3c720ef18d96'), kind: 'environment' };
  const middle = layer('mid-scenery', 'environment', .65, 10);
  const main = layer('scenery', 'environment', 1, 20);
  const placed = item('altar', middle.layerId, asset.assetId);
  const document = map([middle, main], [placed]);
  assert.equal(paletteAssetRoles(document)('module', asset), 'environment');
  assert.deepEqual(groupSceneLayers(document).find(group => group.role === 'middle').rows[0].items, [placed]);
  assert.equal(placementLayer(document.layers, asset, ''), main);
  assert.equal(placementLayer(document.layers, asset, middle.layerId), middle);
  assert.equal(placementLayer([middle], asset, ''), middle);
});

test('generated assets retain their group and new layers preserve the existing draw order', () => {
  const sky = layer('sky', 'background', 0, 0);
  const ground = layer('ground', 'terrain', 1, 1);
  const lower = layer('far.lower', 'environment', 0.2, 1);
  const upper = layer('far.upper', 'environment', 0.3, 2);
  assert.deepEqual(environmentPlacement([sky, lower, upper], 'far', 'far.lower'), { layer: lower, create: false });
  assert.deepEqual(environmentPlacement([sky, lower, upper], 'far', 'sky'), { layer: upper, create: false });
  const asset = { assetId: 'marker', kind: 'environment', placementRole: 'far' };
  assert.equal(paletteAssetRoles(map([sky], [item('used', 'sky')]))('module', asset), 'far');

  const target = environmentPlacement([ground, sky], 'far');
  assert.equal(target.create, true);
  assert.deepEqual(target.layer.parallax, { x: 0.3, y: 1 });
  assert.deepEqual(target.nextLayers.map(({ layerId, zIndex }) => [layerId, zIndex]), [['sky', 0], ['far', 10], ['ground', 20]]);
  assert.equal(ground.zIndex, 1);
});

test('reordered assemblies draw as a block and retain their order through history and reopen', () => {
  const kit=loadSceneKit(fixtureRoot),document=readMap(kit);
  document.terrainRuns=[];document.inspectionCases=[];
  document.assemblyInstances.push({...document.assemblyInstances[0],instanceId:'pair.aaa',column:30});
  const editor=createEditor(kit,document);
  const order=state=>state.getScene().layers.find(layer=>layer.layerId==='environment').nodes.map(node=>node.nodeId);
  const original=order(editor), command={type:'reorder-layer-objects',layerId:'environment',instanceIds:['pair.aaa','pair.main']};
  assert.deepEqual(original,['visual/marker.main','visual/pair.aaa/left/marker','visual/pair.aaa/right/marker','visual/pair.main/left/marker','visual/pair.main/right/marker']);
  assert.equal(editor.execute([command]).changed,true);
  const reordered=[original[0],...original.slice(3),...original.slice(1,3)];
  assert.deepEqual(order(editor),reordered);
  assert.equal(editor.execute([command]).changed,false);
  assert.equal(editor.undo().changed,true);assert.deepEqual(order(editor),original);
  assert.equal(editor.redo().changed,true);assert.deepEqual(order(editor),reordered);
  assert.deepEqual(order(createEditor(kit,JSON.parse(editor.serialize()))),reordered);
});
