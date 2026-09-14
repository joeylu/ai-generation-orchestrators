import {fixtureLayeredZip} from './decomposition-fixture.ts';
import {importDecompositionZip} from '../../src/decomposition-import.ts';
import {createBundle} from '../../src/bundle.ts';
import {appearanceDocumentSha256} from '../../src/appearance-binding.ts';
import {zip,referenceSha256} from '../../src/reference-persistence.ts';
import type {UiDocument,ControlStyle} from '../../src/tree-contract.ts';
import type {ValueTextBindings} from '../../src/value-text-bindings.ts';
export const skillItems=[['ember','Ember Strike'],['tidal','Tidal Guard'],['shadow','Shadow Step'],['verdant','Verdant Mend'],['chain','Chain Spark'],['iron','Iron Resolve']];
export function listTextDocument():UiDocument{
 const style:ControlStyle={backgroundColor:'#F3F5F7',borderColor:'#315322',borderWidth:1,cornerRadius:0,textColor:'#243525',fontFamily:'Arial',fontSize:20,fontWeight:'normal',opacity:1};
 const text=(id:string,x:number,y:number,width:number)=>({id,type:'Text' as const,layout:{x,y,width,height:35},props:{text:'Authored fallback',wrap:'none' as const,overflow:'clip' as const,lineHeight:26,drawBackground:false,style}});
 const valueTextBindings:ValueTextBindings={version:'1.1',bindings:[{sourceId:'skill-list',targetId:'selected-name',parts:['Selected: ',{field:'selectedId',items:skillItems.map(([itemId,text])=>({itemId,text})),emptyText:'(none)'}]},{sourceId:'power',targetId:'power-label',parts:[{field:'value',fractionDigits:0,grouping:'none'}]},{sourceId:'experience',targetId:'experience-label',parts:[{field:'value',fractionDigits:0,grouping:'comma'},' / ',{field:'max',fractionDigits:0,grouping:'comma'}]}]};
 return{schemaVersion:'0.2',id:'list-text-procedural-fixture',canvas:{width:600,height:600},valueTextBindings,root:{id:'root',type:'Container',layout:{x:0,y:0,width:600,height:600},props:{style},children:[
 {id:'skill-list',type:'List',layout:{x:20,y:20,width:400,height:300},props:{selectedId:'tidal',items:skillItems.map(([id,label])=>({id,label:label.toUpperCase()})),itemTemplate:'text-row',itemHeight:50,enabled:true,style},children:[]},text('selected-name',20,340,560),
 {id:'power',type:'Slider',layout:{x:20,y:400,width:220,height:40},props:{value:40,min:0,max:100,step:1,enabled:true,style}},text('power-label',270,400,280),
 {id:'experience',type:'ProgressBar',layout:{x:20,y:500,width:220,height:20},props:{value:2480,max:5000,style}},text('experience-label',270,490,300)
 ]}};
}
export async function listTextHandoffFixture(){
 const d=listTextDocument();const fixture=await fixtureLayeredZip([600,600],[
 {id:'scene-background',role:'background',left:0,top:0,width:600,height:600,color:[243,245,247,255]},
 {id:'list-background',role:'important_component',left:20,top:20,width:400,height:300,color:[235,238,229,255]},
 {id:'list-row',role:'important_component',left:20,top:20,width:400,height:50,color:[245,241,220,255]},
 {id:'list-selected',role:'important_component',left:20,top:70,width:400,height:50,color:[160,205,240,255]},
 {id:'slider-track',role:'important_component',left:20,top:415,width:220,height:10,color:[160,170,180,255]},
 {id:'slider-fill',role:'important_component',left:25,top:417,width:210,height:6,color:[30,140,220,255]},
 {id:'slider-thumb',role:'important_component',left:100,top:400,width:20,height:30,color:[10,80,160,255]},
 {id:'progress-track',role:'important_component',left:20,top:500,width:220,height:20,color:[160,170,180,255]},
 {id:'progress-fill',role:'important_component',left:25,top:505,width:210,height:10,color:[30,140,220,255]}
 ]);const imported=await importDecompositionZip(fixture.zip),target=await createBundle(d,[],{kind:'programmatic-fixture',description:'Six explicit labels; deterministic blocks, not generated Skill Library artwork'});
 const area=(x:number,y:number,width:number,height:number)=>({coordinateSpace:'target-component-local',x,y,width,height});
 const binding={kind:'ui-appearance-binding',version:'0.2',documentSha256:await appearanceDocumentSha256(d),deliveryDigest:imported.deliveryDigest,sceneSha256:imported.sceneSha256,archiveSha256:imported.archiveSha256,registration:{sourceCanvas:{width:600,height:600},targetCanvas:{width:600,height:600},transform:{scale:1,offset:{x:0,y:0}}},bindings:[
 {componentId:'skill-list',componentType:'List',parts:[{role:'background',layerId:'list-background'},{role:'row',layerId:'list-row',itemId:'ember'},{role:'selected-row',layerId:'list-selected',itemId:'tidal'}],states:{list:{labelLayout:{coordinateSpace:'target-item-local',x:12,y:8,width:376,height:34},hitArea:{coordinateSpace:'target-item-local',x:0,y:0,width:400,height:50}}}},
 {componentId:'power',componentType:'Slider',parts:[{role:'track',layerId:'slider-track'},{role:'fill',layerId:'slider-fill'},{role:'thumb',layerId:'slider-thumb'}],states:{slider:{sourceState:'full-range-template',fillClip:{...area(5,17,210,6),anchor:'top-left',direction:'left-to-right'},thumbPositions:{coordinateSpace:'target-component-local',anchor:'top-left',min:{x:0,y:0},max:{x:200,y:0}}}}},
 {componentId:'experience',componentType:'ProgressBar',parts:[{role:'track',layerId:'progress-track'},{role:'fill',layerId:'progress-fill'}],states:{progressBar:{sourceState:'full-range-template',fillClip:{...area(5,5,210,10),anchor:'top-left',direction:'left-to-right'}}}}
 ]};
 const observed=(value:unknown)=>({status:'observed',value,evidence:'Deterministic fixture state only; not observation of user artwork'});
 const state={kind:'ui-reference-state',schemaVersion:'1.0',components:[{componentId:'skill-list',componentType:'List',fields:{selectedId:observed('tidal')}},{componentId:'power',componentType:'Slider',fields:{value:observed(40)}},{componentId:'experience',componentType:'ProgressBar',fields:{value:observed(2480)}}]};
 const scope={kind:'ui-acceptance-scope',schemaVersion:'1.0',referenceState:'reference/reference-state.json',human_visual_acceptance:false,derivedTestStates:[],components:[d.root,...d.root.children].map(n=>({componentId:n.id,mode:'compare',reason:'Procedural fixture only'}))};
 const enc=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));const entries=new Map<string,Uint8Array>([['component.ui-bundle.json',enc(target)],['appearance-binding.json',enc(binding)],['decomposition/fixture.draft.zip',fixture.zip],['reference/original.png',imported.preview.bytes],['reference/reference-state.json',enc(state)],['acceptance-scope.json',enc(scope)]]);
 const entry=async(path:string)=>({path,sha256:await referenceSha256(entries.get(path)!)});const mapping={coordinateSpace:'raw-image-pixel-edges-to-runtime-canvas',sourceSize:[600,600],targetSize:[600,600],crop:[0,0,600,600],rotationDegrees:0,flipX:false,flipY:false,scale:[1,1],offset:[0,0]};
 entries.set('handoff.json',enc({kind:'ai_ui_component_handoff_v2',schemaVersion:'2.0',status:'contracts_packaged_unreviewed_draft',delivery_policy:'unreviewed_draft',human_visual_acceptance:false,component_bundle:await entry('component.ui-bundle.json'),appearance_binding:await entry('appearance-binding.json'),decomposition:await entry('decomposition/fixture.draft.zip'),reference:{original:{...await entry('reference/original.png'),width:600,height:600},state:await entry('reference/reference-state.json'),scope:await entry('acceptance-scope.json'),mapping,derivatives:[]}}));
 return{zip:zip(entries),document:d};
}
