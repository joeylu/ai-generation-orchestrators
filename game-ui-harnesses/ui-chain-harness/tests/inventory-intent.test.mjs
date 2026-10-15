import test from 'node:test';
import assert from 'node:assert/strict';
import base from '../configs/action-presets.json' with {type:'json'};
import {editorData} from '../src/panel/data.mjs';
import {inventoryActionConfig,inventoryPlanningCatalog,validateInventoryActionConfig,inventoryPresetFromIntent} from '../src/panel/inventory-intent.mjs';
import {inventoryIntentFixture} from '../src/panel/inventory-fixtures.mjs';
import {planningClient} from '../src/panel/planning-client.mjs';
import {inventoryLayout} from '../src/runtime/inventory-geometry.mjs';
import {inventoryScrollMode} from '../src/runtime/inventory-policy.mjs';

const data=await editorData(),request={requestVersion:'0.1',id:'inventory-ai-fixture',text:'做一个仓库面板，显示物品及数量，允许选择查看详情。',target:'pixi'};
async function fixture(orientation='landscape',grid){
  const ctx={...data,orientation,...(grid?{grid}: {})},config=inventoryActionConfig(base,ctx),session=await planningClient().prepare({request,catalog:inventoryPlanningCatalog(config)});
  return {ctx,config,session,convert:options=>inventoryPresetFromIntent(session,inventoryIntentFixture(session,config,options),config,'inventory',ctx)};
}
const items=[{slot:0,name:'寒露药剂',quantity:7,icon:null},{slot:7,name:'赤铜矿',quantity:124,icon:null},{slot:19,name:'<水晶> & 灵石',quantity:9999,icon:null}];

test('the dedicated public planning session enables inventory 0.13 and verifies without hand-authored context fields',async()=>{
  const {config,session}=await fixture();
  assert.equal(session.context.planningContextVersion,'0.12');assert.equal(session.responseSchema.properties.panelIntentVersion.enum[0],'0.13');
  assert.equal(session.context.capabilities.rowKinds.includes('inventory'),true);assert.equal(session.context.assetRetrieval,null);
  assert.deepEqual(await planningClient().verify(session),session);
  const catalog=inventoryPlanningCatalog(config);assert.deepEqual(catalog.recipes.map(recipe=>recipe.kind),['inventory-row','text-row']);
  assert.deepEqual(config.inventoryPlanning.capabilities.icons,[null]);assert.equal(config.inventoryPlanning.capabilities.descriptions,'not-in-upstream-intent');
  assert.equal(config.inventoryPlanning.programGrid.rows,4);assert.equal(config.inventoryPlanning.programGrid.columns,5);
  assert.equal(config.inventoryPlanning.version,'1.1');assert.equal(config.inventoryPlanning.layout.version,'1.2');assert.equal(config.inventoryPlanning.layout.scrollMode,inventoryScrollMode);
  catalog.recipes[0].description='changed';assert.notEqual(config.inventoryPlanning.catalog.recipes[0].description,'changed');
});

test('AI content slot quantity selection enabled and independent headings map literally in only the selected orientation',async()=>{
  for(const orientation of ['landscape','portrait']){
    const {ctx,config,session,convert}=await fixture(orientation),options={title:'旅行仓库',sectionTitle:'携带物品',label:'补给格位',items,selectedSlot:7,enabled:false},intent=inventoryIntentFixture(session,config,options),before=structuredClone({ctx,config,intent});
    const preset=await convert(options),doc=preset.documents[orientation],list=doc.nodes.find(node=>node.id==='inventory-grid'),geometry=inventoryLayout(ctx.profile,list.props,list.size.width,list.size.height,ctx.skinGeometry);
    assert.deepEqual(Object.keys(preset.documents),[orientation]);assert.equal(doc.title,options.title);assert.deepEqual(preset.content.items,items);assert.equal(preset.content.sampleData,false);assert.equal(preset.content.iconSource,'none-name-fallback');
    assert.deepEqual(doc.nodes.filter(node=>node.recipeRef==='text@1.0.0').map(node=>node.props.text),[options.title,options.sectionTitle,options.label]);
    assert.equal(list.props.enabled,false);assert.equal(list.props.selectedId,'inventory-slot-7');assert.equal(list.props.inventory.initialSlot,7);assert.equal(list.props.items.length,3);
    assert.equal(list.props.inventory.scrollMode,inventoryScrollMode);
    assert.deepEqual(list.props.items.map(item=>({slot:item.slotIndex,name:item.label,quantity:item.quantity,icon:item.icon})),items);
    assert.ok(list.props.items.every(item=>item.description===''&&item.enabled===true));
    assert.equal(geometry.cell.width,config.inventoryPlanning.programGrid.cellWidth);assert.equal(geometry.cell.height,config.inventoryPlanning.programGrid.cellHeight);
    assert.deepEqual(preset.behavior,{version:'1.0',fields:[],actions:[],dismissOnEmit:false});assert.deepEqual({ctx,config,intent},before);
    assert.deepEqual(await convert(options),preset);
  }
});

test('empty and one-slot inventories never inject samples; empty-slot initial selection is preserved without inventing an item ID',async()=>{
  for(const grid of [{columns:1,rows:1},{columns:6,rows:4}]){
    const {config,convert}=await fixture('portrait',grid),preset=await convert({items:[],selectedSlot:grid.columns*grid.rows-1}),list=preset.documents.portrait.nodes.find(node=>node.id==='inventory-grid');
    assert.deepEqual(list.props.items,[]);assert.equal(list.props.selectedId,null);assert.equal(list.props.inventory.initialSlot,grid.columns*grid.rows-1);
    assert.equal(preset.content.items.length,0);assert.equal(config.inventoryPlanning.programGrid.columns,grid.columns);assert.equal(config.inventoryPlanning.programGrid.rows,grid.rows);
    const none=await convert(),props=none.documents.portrait.nodes.find(node=>node.id==='inventory-grid').props;
    assert.equal(Object.hasOwn(props.inventory,'initialSlot'),false);assert.equal(props.selectedId,null);
  }
});

test('frozen configuration validates against the same skin and canvas without rereading mutable layout defaults',async()=>{
  const {ctx,config}=await fixture(),before=structuredClone(config);
  assert.deepEqual(validateInventoryActionConfig(config,ctx),config);assert.deepEqual(config,before);
  const changed=structuredClone(config);changed.inventoryPlanning.programGrid.cellWidth--;changed.inventoryPlanning.programGrid.cellHeight--;
  assert.throws(()=>validateInventoryActionConfig(changed,ctx),{code:'panel.inventory-geometry'});
  assert.throws(()=>validateInventoryActionConfig(config,{...ctx,orientation:'portrait'}),{code:'panel.inventory-orientation'});
  for(const grid of [{columns:0,rows:4},{columns:33,rows:1},{columns:12,rows:13},{columns:32,rows:5},{columns:2,rows:0},{columns:2},{columns:2,rows:3,truncate:true}])assert.throws(()=>inventoryActionConfig(base,{...ctx,grid}),{code:'panel.inventory-grid'});
  const wide=structuredClone(config);wide.inventoryPlanning.capabilities.icons.push('gem');assert.throws(()=>validateInventoryActionConfig(wide),{code:'panel.inventory-config'});
});

test('new frozen plans support 144 cells and asymmetric 32-axis grids without shrinking cells',async()=>{
  for(const orientation of ['landscape','portrait'])for(const grid of [{columns:12,rows:12},{columns:32,rows:4},{columns:4,rows:32}]){
    const {ctx,config,convert}=await fixture(orientation,grid),last=grid.columns*grid.rows-1,preset=await convert({items:[{slot:last,name:'末格',quantity:9999,icon:null}],selectedSlot:last}),list=preset.documents[orientation].nodes.find(node=>node.id==='inventory-grid'),layout=inventoryLayout(ctx.profile,list.props,list.size.width,list.size.height,ctx.skinGeometry);
    assert.equal(list.props.inventory.scrollMode,inventoryScrollMode);assert.equal(layout.cell.width,config.inventoryPlanning.programGrid.cellWidth);assert.equal(layout.cell.height,config.inventoryPlanning.programGrid.cellHeight);assert.equal(list.props.items[0].slotIndex,last);assert.equal(list.props.inventory.initialSlot,last);
    assert.equal(layout.capacity,grid.columns*grid.rows);assert.ok(layout.grid.contentWidth<=4000&&layout.grid.contentHeight<=4000);
    assert.ok(grid.columns<12||layout.grid.contentWidth>layout.grid.width);assert.ok(grid.rows<12||layout.grid.contentHeight>layout.grid.height);
  }
});

test('new plans reject frozen geometry over 4000 before conversion',async()=>{
  const {config}=await fixture('landscape',{columns:32,rows:4}),changed=structuredClone(config);
  changed.inventoryPlanning.programGrid.cellWidth=128;changed.inventoryPlanning.programGrid.cellHeight=128;
  assert.throws(()=>validateInventoryActionConfig(changed),{code:'panel.inventory-grid'});
  const large=structuredClone(data);large.profile.fontSize=48;large.profile.geometry.lineHeight=58;
  assert.throws(()=>inventoryActionConfig(base,{...large,orientation:'landscape',grid:{columns:32,rows:4}}),{code:'panel.inventory-grid'});
});

test('legacy frozen planning 1.0 retains its capabilities and vertical fit geometry',async()=>{
  const {ctx,config}=await fixture(),legacy=structuredClone(config),policy=legacy.inventoryPlanning;
  policy.version='1.0';policy.layout.version='1.1';delete policy.layout.scrollMode;
  policy.capabilities.version='1.0';policy.capabilities.columns.maximum=10;policy.capabilities.rows.maximum=10;
  for(const key of ['maximumCells','maximumGridDimension','scrollMode'])delete policy.capabilities[key];
  assert.deepEqual(validateInventoryActionConfig(legacy,ctx),legacy);
  const session=await planningClient().prepare({request,catalog:inventoryPlanningCatalog(legacy)}),intent=inventoryIntentFixture(session,legacy),preset=await inventoryPresetFromIntent(session,intent,legacy,'inventory',ctx),list=preset.documents.landscape.nodes.find(node=>node.id==='inventory-grid');
  assert.equal(Object.hasOwn(list.props.inventory,'scrollMode'),false);assert.equal(list.props.inventory.cellSize,policy.programGrid.cellWidth);
  const incompatible=structuredClone(legacy);incompatible.inventoryPlanning.programGrid.columns=11;
  assert.throws(()=>validateInventoryActionConfig(incompatible),{code:'panel.inventory-grid'});
});

test('all upstream geometry fields are exact and unsupported content never becomes a replacement layout',async()=>{
  const {ctx,config,session}=await fixture(),convert=intent=>inventoryPresetFromIntent(session,intent,config,'inventory',ctx);
  for(const mutate of [i=>i.panel.body.children[0].rows[0].grid.rows=3,i=>i.panel.body.children[0].rows[0].grid.cellWidth=79,i=>i.panel.body.children[0].rows[0].grid.cellHeight=79,i=>i.panel.body.children[0].rows[0].grid.spacingX=9,i=>i.panel.body.children[0].rows[0].grid.spacingY=9,i=>i.panel.body.children[0].rows[0].grid.padding=1,i=>i.panel.body.children[0].rows[0].grid.startCorner='lower-right',i=>i.panel.body.children[0].rows[0].grid.startAxis='vertical']){
    const intent=inventoryIntentFixture(session,config);mutate(intent);await assert.rejects(convert(intent),{code:'panel.inventory-grid'});
  }
  for(const mutate of [i=>i.panel.body.kind='row',i=>i.panel.body.children.push(structuredClone(i.panel.body.children[0])),i=>i.panel.body.children[0].rows.push(structuredClone(i.panel.body.children[0].rows[0]))]){
    const intent=inventoryIntentFixture(session,config);mutate(intent);await assert.rejects(convert(intent),{code:'panel.inventory-unsupported'});
  }
  const text=inventoryIntentFixture(session,config),recipe=config.inventoryPlanning.catalog.recipes.find(recipe=>recipe.kind==='text-row');
  text.panel.body.children[0].rows=[{kind:'text',label:'说明',recipeKey:recipe.id+'@'+recipe.version,sourceRef:'request',icon:null,text:'不能静默丢弃',wrap:'word'}];
  await assert.rejects(convert(text),{code:'panel.inventory-unsupported'});
  const dimensions=inventoryIntentFixture(session,config);dimensions.panel.layout.width=500;await assert.rejects(convert(dimensions),{code:'panel.inventory-layout'});
  const unresolved=inventoryIntentFixture(session,config);unresolved.panel=null;await assert.rejects(convert(unresolved),{code:'panel.inventory-unresolved'});
});

test('invalid items invented descriptions pinned artwork and duplicate ownership fail before document output',async()=>{
  const {ctx,config,session}=await fixture(),convert=intent=>inventoryPresetFromIntent(session,intent,config,'inventory',ctx);
  for(const mutate of [row=>row.items[0].description='invented',row=>row.items[0].icon='items/gem@1.0.0',row=>row.items.push({...row.items[0]}),row=>row.items[0].slot=20,row=>row.items[0].quantity=10000,row=>row.selectedSlot=20,row=>row.items[0].name='仓'.repeat(65),row=>row.items[0].span=2]){
    const intent=inventoryIntentFixture(session,config,{items:[items[0]]});mutate(intent.panel.body.children[0].rows[0]);const before=structuredClone(intent);
    await assert.rejects(convert(intent));assert.deepEqual(intent,before);
  }
  for(const title of [' 不是可见首尾空白 ','仓'.repeat(41)])await assert.rejects(()=>inventoryPresetFromIntent(session,inventoryIntentFixture(session,config,{title}),config,'inventory',ctx),{code:'inventory.title'});
});
