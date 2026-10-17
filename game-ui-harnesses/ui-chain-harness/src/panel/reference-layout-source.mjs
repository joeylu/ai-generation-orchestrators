// Freeze the selected template's compiled geometry alongside each new plan.
// Old plans keep their captured layout; no model call is involved here.
import {templateInput} from '../../../ui-reference-harness/web/template-previews.mjs';
import {loadWorkspaceCore} from '../../../ui-panel-harness/src/component-adapter.mjs';
import {createPanelBundle} from '../../../ui-panel-harness/src/panel-bundle.mjs';
import {visualStructure} from '../../../ui-reference-harness/src/panel.mjs';
import {referencePreset} from './reference-presets.mjs';
export async function freezeReferenceLayout(config,id){
 const {spec,catalog}=templateInput(id),bundle=await createPanelBundle(spec,catalog,await loadWorkspaceCore());
 const nodes=visualStructure(bundle.componentBundle.document),panel=nodes.find(n=>n.id===id+'.panel');
 if(!panel)throw Error('REFERENCE_PANEL_GEOMETRY_MISSING');
 if(nodes.some(n=>!['Container','Text','Switch','Select','Button','ProgressBar'].includes(n.type)))throw Error('REFERENCE_LAYOUT_CONTROL_UNSUPPORTED');
 const props=new Map();function visit(n){props.set(n.id,n.props);for(const c of n.children??[])visit(c);}visit(bundle.componentBundle.document.root);
 const leaves=nodes.filter(n=>['Text','Switch','Select','Button','ProgressBar'].includes(n.type)&&!n.id.endsWith('.center-label'));
 const fields=[];
 if(id==='sdk-settings')for(const n of leaves.filter(n=>['Switch','Select'].includes(n.type)))fields.push({type:n.type,source:n.id,label:n.id.replace(/\.control$/,'.label')});
 else for(const n of leaves){
  if(n.type==='Text'&&!n.id.endsWith('.title')&&!n.id.endsWith('.percentage')){
   if(n.id.endsWith('.value')&&leaves.some(v=>v.id===n.id.replace(/\.value$/,'.label')))continue;
   const value=n.id.endsWith('.label')?leaves.find(v=>v.id===n.id.replace(/\.label$/,'.value')):null;
   fields.push({type:'Text',source:value?.id??n.id,...(value?{label:n.id}:{})});
  }
  if(n.type==='ProgressBar')fields.push({type:n.type,source:n.id,percentage:leaves.find(v=>v.id.endsWith('.percentage'))?.id});
 }
 const referenceLayout={version:1,id,sourceSha256:referencePreset(id).sourceSha256,panel:panel.box,fields,actions:leaves.filter(n=>n.type==='Button').map(n=>n.id),nodes:leaves.map(n=>({...n,props:props.get(n.id)}))};
 return {...structuredClone(config),referenceLayout};
}
