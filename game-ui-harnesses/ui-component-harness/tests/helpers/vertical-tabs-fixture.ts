import { createHash } from 'node:crypto';
import { appearanceDocumentSha256, type AppearanceBindingDocument, type AppearancePartBinding } from '../../src/appearance-binding.ts';
import { createBundle } from '../../src/bundle.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import type { ControlStyle, UiDocument } from '../../src/tree-contract.ts';
import { fixtureLayeredZip, forceZip64Stored, type LayeredFixtureInput } from './decomposition-fixture.ts';

const style: ControlStyle = { backgroundColor: '#101820', borderColor: '#101820', borderWidth: 0, cornerRadius: 0, textColor: '#E4F2FC', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 };
export const verticalTabCells = [{ id: 'combat', x: 0, y: 0, width: 180 }, { id: 'audio', x: 0, y: 76, width: 180 }, { id: 'accessibility', x: 0, y: 152, width: 180 }];
const local = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const itemLocal = (x: number, y: number, width: number, height: number) => ({ coordinateSpace: 'target-item-local' as const, ...local(x, y, width, height) });

export async function verticalTabsFixture() {
  const document: UiDocument = { schemaVersion: '0.2', id: 'vertical-tabs-fixture', canvas: { width: 600, height: 400 }, root: {
    id: 'root', type: 'Container', layout: local(0, 0, 600, 400), props: { style }, children: [{
      id: 'vertical-tabs', type: 'Tabs', layout: local(20, 20, 560, 340), props: {
        activeId: 'combat', tabs: verticalTabCells.map(q => ({ id: q.id, label: q.id.toUpperCase(), contentId: q.id + '-content' })), enabled: true, style,
      }, children: verticalTabCells.map(q => ({ id: q.id + '-content', type: 'Container', layout: local(200, 0, 360, 300), props: { style: { ...style, backgroundColor: q.id === 'combat' ? '#802020' : q.id === 'audio' ? '#208020' : '#202080' } }, children: [] })),
    }],
  } };
  const layers: LayeredFixtureInput[] = [{ id: 'scene-background', role: 'background', left: 0, top: 0, width: 600, height: 400 }];
  const parts: AppearancePartBinding[] = [];
  for (const [index, q] of verticalTabCells.entries()) {
    for (const [role, color] of [['tab', [30 + index * 30, 50, 70, 255]], ['active-tab', [20, 150 + index * 30, 210, 255]]] as const) {
      const id = q.id + '-' + role;
      layers.push({ id, role: 'important_component', left: 20 + q.x, top: 20 + q.y, width: q.width, height: 64, color });
      parts.push({ role, layerId: id, tabId: q.id });
    }
    for (const [role, color] of [['icon', [180, 90, 60, 255]], ['active-icon', [250, 240, 210, 255]]] as const) {
      const id = q.id + '-' + role;
      layers.push({ id, role: 'important_component', left: 20 + q.x + 15, top: 36 + q.y, width: 32, height: 32, color });
      parts.push({ role, layerId: id, tabId: q.id });
    }
  }
  const fixture = await fixtureLayeredZip([600, 400], layers), imported = await importDecompositionZip(fixture.zip);
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Vertical native Tabs rail with right-side pages. Procedural fixture, no generated artwork.' });
  const items = verticalTabCells.map(q => ({ tabId: q.id, layout: { coordinateSpace: 'target-component-local' as const, ...local(q.x, q.y, q.width, 64) }, labelLayout: itemLocal(56, 12, q.width - 62, 42), hitArea: itemLocal(0, 0, q.width, 64) }));
  const binding: AppearanceBindingDocument = { kind: 'ui-appearance-binding', version: '0.2', documentSha256: await appearanceDocumentSha256(document), deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256, archiveSha256: imported.archiveSha256,
    registration: { sourceCanvas: document.canvas, targetCanvas: document.canvas, transform: { scale: 1, offset: { x: 0, y: 0 } } }, bindings: [{ componentId: 'vertical-tabs', componentType: 'Tabs', parts, states: { tabs: {
      layoutPolicy: { version: '1.0', orientation: 'vertical' }, headerHeight: 64, labelLayout: items[0].labelLayout, hitArea: items[0].hitArea, items,
      icons: verticalTabCells.map(q => ({ tabId: q.id, iconLayout: itemLocal(15, 16, 32, 32), activeIconLayout: itemLocal(15, 16, 32, 32) })),
    } } }],
  };
  return { document, fixture, imported, target, binding, layers };
}

export async function verticalTabsHandoff() {
  const f = await verticalTabsFixture();
  const bytes = (v: unknown) => Buffer.from(JSON.stringify(v)), hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
  const bundle = bytes(f.target), binding = bytes(f.binding);
  const manifest = { kind: 'ai_ui_component_handoff_v1', status: 'contracts_packaged_unreviewed_draft', decomposition: { path: 'decomposition/ui.draft.zip', sha256: hash(f.fixture.zip) }, component_bundle: { path: 'component.ui-bundle.json', sha256: hash(bundle) }, appearance_binding: { path: 'appearance-binding.json', sha256: hash(binding) }, delivery_policy: 'unreviewed_draft', human_visual_acceptance: false };
  return forceZip64Stored([{ name: 'handoff.json', bytes: bytes(manifest) }, { name: 'decomposition/ui.draft.zip', bytes: f.fixture.zip }, { name: 'component.ui-bundle.json', bytes: bundle }, { name: 'appearance-binding.json', bytes: binding }]);
}

export async function verticalTabsReferenceHandoff(modal = false) {
  const f = await verticalTabsFixture(), document = structuredClone(f.document);
  if (modal) {
    const tabs = document.root.type === 'Container' ? document.root.children[0] : undefined;
    if (!tabs || document.root.type !== 'Container') throw Error('fixture root');
    document.root.children = [
      { id: 'outside-probe', type: 'Button', layout: local(500,350,90,40), props: {label:'Probe',enabled:true,style}, children:[] },
      { id: 'settings-modal', type: 'Dialog', layout: local(0,0,600,400), props: {open:true,modal:true,title:'',style},children:[tabs] },
    ];
  }
  const bundle = await createBundle(document, [], {kind:'programmatic-fixture',description:'Vertical Tabs reference fixture; no user artwork or media services.'});
  let fixture=f.fixture;
  const binding = structuredClone({...f.binding, documentSha256:await appearanceDocumentSha256(document)});
  if(modal){
    fixture=await fixtureLayeredZip([600,400],[...f.layers,
      {id:'modal-header',role:'important_component',left:0,top:0,width:600,height:1},
      {id:'probe-base',role:'important_component',left:500,top:350,width:90,height:40}]);
    const imported=await importDecompositionZip(fixture.zip);
    Object.assign(binding,{deliveryDigest:imported.deliveryDigest,sceneSha256:imported.sceneSha256,archiveSha256:imported.archiveSha256});
    binding.bindings.push({componentId:'settings-modal',componentType:'Dialog',parts:[{role:'background',layerId:'scene-background'},{role:'header',layerId:'modal-header'}],states:{dialog:{titleLayout:{coordinateSpace:'target-component-local',x:0,y:0,width:600,height:1}}}});
    binding.bindings.push({componentId:'outside-probe',componentType:'Button',parts:[{role:'background',layerId:'probe-base'}],states:{button:{labelLayout:{coordinateSpace:'target-component-local',x:2,y:2,width:86,height:36}}}});
  }
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v));
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  const state={kind:'ui-reference-state',schemaVersion:'1.0',components:[{componentId:'vertical-tabs',componentType:'Tabs',fields:{activeId:{status:'observed',value:'combat',evidence:'Explicit procedural fixture state, not original artwork.'}}}]};
  const scope={kind:'ui-acceptance-scope',schemaVersion:'1.0',referenceState:'reference/reference-state.json',human_visual_acceptance:false,derivedTestStates:[],components:[{componentId:'vertical-tabs',mode:'compare',reason:'Procedural fixture target.'}]};
  if (modal) state.components.push({componentId:'settings-modal',componentType:'Dialog',fields:{open:{status:'observed',value:true,evidence:'Explicit procedural modal fixture.'}}} as any);
  scope.components=[];
  const cover=(node: any)=>{scope.components.push({componentId:node.id,mode:'compare',reason:'Procedural fixture target.'});for(const child of node.children??[])cover(child);};
  cover(document.root);
  const mapping={coordinateSpace:'raw-image-pixel-edges-to-runtime-canvas',sourceSize:[600,400],targetSize:[600,400],crop:[0,0,600,400],rotationDegrees:0,flipX:false,flipY:false,scale:[1,1],offset:[0,0]};
  const members=new Map<string,Uint8Array>([['component.ui-bundle.json',encode(bundle)],['appearance-binding.json',encode(binding)],['decomposition/fixture.zip',fixture.zip],['reference/original.png',f.imported.preview.bytes],['reference/reference-state.json',encode(state)],['acceptance-scope.json',encode(scope)]]);
  const entry=(path:string)=>({path,sha256:sha(members.get(path)!)});
  const manifest={kind:'ai_ui_component_handoff_v2',schemaVersion:'2.0',status:'contracts_packaged_unreviewed_draft',delivery_policy:'unreviewed_draft',human_visual_acceptance:false,component_bundle:entry('component.ui-bundle.json'),appearance_binding:entry('appearance-binding.json'),decomposition:entry('decomposition/fixture.zip'),reference:{original:{...entry('reference/original.png'),width:600,height:400},mapping,state:entry('reference/reference-state.json'),scope:entry('acceptance-scope.json')}};
  Object.assign(manifest.reference,{derivatives:[]});
  members.set('handoff.json',encode(manifest));
  return forceZip64Stored([...members].map(([name,bytes])=>({name,bytes})));
}
