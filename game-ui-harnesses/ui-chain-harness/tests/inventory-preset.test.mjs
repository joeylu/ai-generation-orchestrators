import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {mkdtemp,writeFile,unlink,rmdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {inventoryPanelConfig,inventoryPresetChoice,inventoryPresetContext,inventoryPresetDocument,inventoryPreset,validateInventoryConfig,inventoryTitle,inventoryGrid} from '../src/panel/inventory-preset.mjs';
import {inventoryLayout} from '../src/runtime/inventory-geometry.mjs';
import {inventoryScrollMode} from '../src/runtime/inventory-policy.mjs';
import {createInventoryPreview} from '../scripts/inventory-preview.mjs';
import {hash} from '../src/skins/package.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),data=await editorData();
test('Chain inventory choice is an explicit deterministic local preset with eight identified examples',()=>{
  assert.equal(inventoryPresetChoice.id,'inventory');assert.equal(inventoryPresetChoice.builder,'deterministic-inventory');assert.equal(inventoryPresetChoice.group,'inventory');
  const config=validateInventoryConfig(inventoryPanelConfig);
  assert.equal(config.columns*config.rows,20);assert.equal(config.items.length,8);
  assert.equal(inventoryPresetChoice.name,'仓库面板');assert.equal(inventoryPresetChoice.variant,'物品仓库');
  assert.equal(inventoryPresetChoice.defaultColumns,5);assert.equal(inventoryPresetChoice.defaultRows,4);assert.equal(inventoryPresetChoice.minimumCapacity,8);
  assert.equal(new Set(config.items.map(item=>item.slotIndex)).size,8);
  assert.deepEqual(config.items.map(item=>item.slotIndex),[0,1,2,3,4,5,6,7]);
  assert.ok(config.items.every(item=>!item.description.includes('程序')&&!item.description.includes('不执行')));
  config.items[0].label='independent';assert.equal(inventoryPanelConfig.items[0].label,'药水');
});

test('each selected orientation compiles one compact authoring tree with exact inventory topology',()=>{
  for(const orientation of ['landscape','portrait']){
    const ctx={...data,orientation},before=structuredClone(ctx),preset=inventoryPreset(ctx),document=preset.documents[orientation],derived=inventoryPresetContext(ctx);
    assert.deepEqual(Object.keys(preset.documents),[orientation]);assert.equal(document.canvas,orientation);assert.equal(document.nodes.length,5);
    assert.deepEqual(preset.behavior,{version:'1.0',fields:[],actions:[],dismissOnEmit:false});assert.equal(preset.content.iconSource,'deterministic-example-vectors');assert.equal(preset.content.sampleData,true);
    const inventory=document.nodes.find(node=>node.id==='inventory-grid'),surface=document.nodes.find(node=>node.id==='inventory-surface');
    assert.deepEqual(inventory.props.inventory,{columns:5,rows:4,gap:10,details:orientation==='landscape'?'right':'below',appearance:'slots'});
    assert.equal(inventory.props.items.length,8);assert.equal(inventory.props.selection,'single');assert.equal(inventory.props.selectedId,inventoryPanelConfig.items[0].id);
    assert.deepEqual(inventory.props.items,inventoryPanelConfig.items);assert.deepEqual(document.bindings,ctx.binding);
    const layout=inventoryLayout(ctx.profile,inventory.props,inventory.size.width,inventory.size.height);
    assert.equal(layout.grid.columns,5);assert.equal(layout.grid.rows,4);assert.equal(layout.capacity,20);assert.equal(layout.cell.width,layout.cell.height);
    assert.equal(layout.cell.width,80);assert.equal(layout.grid.scrollable,false);
    assert.ok(surface.size.width<ctx.canvases.presets[orientation].width-100);assert.ok(surface.size.height<ctx.canvases.presets[orientation].height-100);
    assert.ok(layout.grid.width<=inventory.size.width);assert.ok(surface.position.x>=24&&surface.position.y>=24);
    assert.deepEqual(validateDocument(document,derived),document);assert.deepEqual(ctx,before);
  }
});

test('title is literal authored copy and longer legal titles reserve wrapped heading space',()=>{
  const title='仓库 <示例> & </script>',ctx={...data,orientation:'portrait'},document=inventoryPresetDocument(ctx,inventoryPanelConfig,title);
  assert.equal(document.title,title);assert.equal(document.nodes.find(node=>node.id==='inventory-heading').props.text,title);
  const long=inventoryPresetDocument(ctx,inventoryPanelConfig,'仓'.repeat(40));
  assert.equal(long.title.length,40);assert.equal(long.nodes.find(node=>node.id==='inventory-heading').props.wrap,'word');
  assert.ok(long.nodes.find(node=>node.id==='inventory-heading').size.height>=ctx.profile.geometry.lineHeight*2);
  for(const value of ['', 'x'.repeat(41), '换行\n标题', 3])assert.throws(()=>inventoryTitle(value),{code:'inventory.title'});
});

test('invalid data, geometry, orientation and unknown config fields fail instead of changing the inventory',()=>{
  for(const mutate of [config=>config.columns=0,config=>config.rows=11,config=>config.columns=1,config=>config.items[0].slotIndex=20,config=>config.items[1].slotIndex=config.items[0].slotIndex,config=>config.items[1].id=config.items[0].id,config=>config.items[0].quantity=0,config=>config.items[0].icon='external-path',config=>config.items[0].description='',config=>config.transport={endpoint:'forbidden'},config=>config.items[0].extra=true]){
    const config=structuredClone(inventoryPanelConfig);mutate(config);assert.throws(()=>validateInventoryConfig(config));
  }
  for(const orientation of [undefined,'square'])assert.throws(()=>inventoryPresetDocument({...data,orientation}));
  const tooNarrow=structuredClone(inventoryPanelConfig);tooNarrow.orientations.portrait.maxWidth=200;
  assert.throws(()=>inventoryPresetDocument({...data,orientation:'portrait'},tooNarrow),{code:'inventory.geometry'});
});

test('new grid shape explicitly places all template samples in order and never truncates authored data',()=>{
  const before=structuredClone(inventoryPanelConfig),preset=inventoryPreset({...data,orientation:'landscape'},inventoryPanelConfig,undefined,{columns:6,rows:4}),props=preset.documents.landscape.nodes.find(node=>node.id==='inventory-grid').props;
  assert.equal(preset.content.columns,6);assert.equal(preset.content.rows,4);assert.equal(preset.content.samplePlacement,'template-order');
  assert.deepEqual(props.items.map(item=>item.slotIndex),[0,1,2,3,4,5,6,7]);
  assert.deepEqual(props.items.map(({slotIndex,...item})=>item),before.items.map(({slotIndex,...item})=>item));assert.deepEqual(inventoryPanelConfig,before);
  assert.equal(inventoryGrid(before,{columns:2,rows:4}).items.length,8);
  assert.throws(()=>inventoryGrid(before,{columns:1,rows:7}),{code:'inventory.capacity'});
  for(const grid of [{columns:6},{columns:6,rows:undefined},{columns:null,rows:null},{columns:1.2,rows:4},{columns:11,rows:4},{columns:5,rows:4,dropItems:true}])assert.throws(()=>inventoryGrid(before,grid),{code:'inventory.grid'});
});

test('the compact cell target is an actual layout input rather than ignored configuration',()=>{
  for(const cellTarget of [72,88]){
    const config=structuredClone(inventoryPanelConfig);config.cellTarget=cellTarget;
    const doc=inventoryPresetDocument({...data,orientation:'landscape'},config),list=doc.nodes.find(node=>node.id==='inventory-grid');
    assert.equal(inventoryLayout(data.profile,list.props,list.size.width,list.size.height).cell.width,cellTarget);
  }
});

test('explicit 1.2 presets keep fixed cells while old 1.1 configuration stays unchanged',()=>{
  const legacy=structuredClone(inventoryPanelConfig),fixed={...structuredClone(legacy),version:'1.2',scrollMode:inventoryScrollMode};
  for(const orientation of ['landscape','portrait']){
    const doc=inventoryPresetDocument({...data,orientation},fixed,undefined,{columns:32,rows:4}),list=doc.nodes.find(node=>node.id==='inventory-grid'),layout=inventoryLayout(data.profile,list.props,list.size.width,list.size.height);
    assert.equal(list.props.inventory.scrollMode,inventoryScrollMode);assert.equal(list.props.inventory.cellSize,fixed.cellTarget);assert.equal(layout.cell.width,fixed.cellTarget);assert.equal(layout.capacity,128);assert.ok(layout.grid.contentWidth>layout.grid.width);
  }
  for(const grid of [{columns:33,rows:1},{columns:12,rows:13},{columns:32,rows:5}])assert.throws(()=>inventoryGrid(fixed,grid),{code:'inventory.grid'});
  assert.deepEqual(inventoryPanelConfig,legacy);assert.equal(inventoryPanelConfig.version,'1.1');
});

test('frozen 1.0 ten-by-ten config preserves slots, skin presentation and selected ratio',()=>{
  const legacy=structuredClone(inventoryPanelConfig);legacy.version='1.0';legacy.columns=10;legacy.rows=10;legacy.gap=4;
  for(const key of ['appearance','samplePlacement','cellTarget'])delete legacy[key];
  legacy.orientations={landscape:{width:1232,height:672,details:'right'},portrait:{width:672,height:1232,details:'below'}};
  const slots=[0,1,7,12,27,48,76,99];legacy.items.forEach((item,index)=>item.slotIndex=slots[index]);
  validateInventoryConfig(legacy);const before=structuredClone(legacy);
  for(const orientation of ['landscape','portrait']){
    const doc=inventoryPresetDocument({...data,orientation},legacy),withEqualFlags=inventoryPresetDocument({...data,orientation},legacy,undefined,{columns:10,rows:10});
    const list=doc.nodes.find(node=>node.id==='inventory-grid');
    assert.equal(list.props.inventory.appearance,undefined);assert.equal(list.props.inventory.columns*list.props.inventory.rows,100);assert.deepEqual(list.props.items.map(item=>item.slotIndex),slots);
    assert.deepEqual(doc,withEqualFlags);assert.equal(doc.canvas,orientation);
  }
  assert.deepEqual(legacy,before);assert.throws(()=>inventoryGrid(legacy,{columns:5,rows:4}),{code:'inventory.grid-legacy'});
});

test('preview producer refuses unsafe output and missing ratio before skin reads or artifact writes',async()=>{
  await assert.rejects(createInventoryPreview({packageDirectory:'not-read',out:join(root,'configs'),orientation:'landscape'}),{code:'INVENTORY_OUTPUT_BOUNDARY'});
  await assert.rejects(createInventoryPreview({packageDirectory:'not-read',out:join(root,'work','inventory-never-written')}),{code:'INVENTORY_ARGUMENTS'});
  await assert.rejects(createInventoryPreview({packageDirectory:'not-read',out:join(root,'work','inventory-never-written'),orientation:'landscape',columns:1,rows:1}),{code:'inventory.capacity'});
});

test('frozen config digest checks the same bytes before parsing, skin reads or output writes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'inventory-preview-config-')),configFile=join(directory,'config.json');
  const out=join(root,'work','inventory-config-digest-'+randomUUID()),packageDirectory=join(directory,'missing-package');
  const config=structuredClone(inventoryPanelConfig);config.defaultTitle='旅行仓库';config.gap=8;
  const bytes=Buffer.from(JSON.stringify(validateInventoryConfig(config))),expectedConfigSha256=hash(bytes);
  try{
    await writeFile(configFile,bytes,{flag:'wx'});
    await assert.rejects(createInventoryPreview({packageDirectory,out,orientation:'landscape',configFile,expectedConfigSha256:'0'.repeat(64)}),{code:'INVENTORY_CONFIG_CHANGED'});
    const cli=spawnSync(process.execPath,[join(root,'scripts/inventory-preview.mjs'),'--package',packageDirectory,'--out',out,'--orientation','landscape','--config',configFile,'--config-sha256','0'.repeat(64)],{cwd:root,encoding:'utf8'});
    assert.equal(cli.status,1);assert.equal(JSON.parse(cli.stderr.trim()).code,'INVENTORY_CONFIG_CHANGED');
    // A matching digest and legacy callers without one still proceed to the
    // existing grid gate, before the deliberately missing skin is inspected.
    for(const digest of [expectedConfigSha256,undefined])await assert.rejects(createInventoryPreview({packageDirectory,out,orientation:'landscape',configFile,expectedConfigSha256:digest,columns:1,rows:1}),{code:'inventory.capacity'});
    await writeFile(configFile,'{changed after plan');
    await assert.rejects(createInventoryPreview({packageDirectory,out,orientation:'landscape',configFile,expectedConfigSha256}),{code:'INVENTORY_CONFIG_CHANGED'});
    await assert.rejects(access(out),{code:'ENOENT'});
  }finally{await unlink(configFile);await rmdir(directory);}
});
