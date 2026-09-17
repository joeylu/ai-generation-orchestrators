import { validateBundle, type UiBundle } from './bundle.ts';
export const mutableState: Record<string, string[]> = { Tabs:['activeId'],CheckBox:['checked'],Switch:['checked'],RadioGroup:['selectedId'],List:['selectedId'],Select:['selectedId'],ScrollView:['scrollX','scrollY'],Input:['value'],Slider:['value'],ProgressBar:['value'],Dialog:['open'] };
export function stateNodes(document:any): any[] { const all:any[]=[]; const visit=(n:any)=>{all.push(n);for(const c of n.children??[])visit(c);};visit(document.root);return all; }
function canonical(v:any):string { if(v===null||typeof v!=='object')return JSON.stringify(v);return Array.isArray(v)?`[${v.map(canonical)}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`; }
export async function validateRuntimeBundle(value:unknown, source:unknown):Promise<UiBundle> {
 for(const input of [value,source]) if((input as any)?.componentHandoff || (input as any)?.bundleVersion==='0.3')throw Error('RECURSIVE_COMPONENT_HANDOFF');
 const runtime=await validateBundle(value), sample=await validateBundle(source);
 const stable=(b:UiBundle)=>{const c:any=structuredClone(b);delete c.document.linkageState;delete c.motion;delete c.motionSystem;delete c.bundleVersion;for(const n of stateNodes(c.document))for(const k of mutableState[n.type]??[])delete n.props[k];return canonical(c);};
 if(stable(runtime)!==stable(sample))throw Error('RUNTIME_BUNDLE_STRUCTURE_MISMATCH');return runtime;
}
export function restoreRuntimeBundle(target:UiBundle, runtime:UiBundle):UiBundle {
 const result:any=structuredClone(target), byId=new Map(stateNodes(runtime.document).map(n=>[n.id,n]));
 for(const n of stateNodes(result.document))for(const k of mutableState[n.type]??[])n.props[k]=byId.get(n.id).props[k];
 if('linkageState' in runtime.document)result.document.linkageState=structuredClone(runtime.document.linkageState);else delete result.document.linkageState;
 for(const k of ['motion','motionSystem'] as const){if(runtime[k])result[k]=runtime[k];else delete result[k];}
 result.bundleVersion=result.motionSystem?'0.2':'0.1';return result;
}

