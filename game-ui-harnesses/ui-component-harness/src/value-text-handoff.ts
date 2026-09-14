import {compileComponentHandoff} from './component-handoff.ts';
import {componentHandoffEntries} from './decomposition-import.ts';
import {zip,referenceSha256} from './reference-persistence.ts';
import {validateValueTextBindings} from './value-text-bindings.ts';
import {appearanceDocumentSha256} from './appearance-binding.ts';
/** Author an explicit new binding attachment without rewriting reference evidence. */
export async function bindHandoffValueText(input:Uint8Array,bindings:unknown):Promise<Uint8Array>{
 await compileComponentHandoff(input);const entries=await componentHandoffEntries(input);
 const read=(p:string)=>JSON.parse(new TextDecoder().decode(entries.get(p)!));const write=(p:string,v:unknown)=>entries.set(p,new TextEncoder().encode(JSON.stringify(v)));
 const manifest=read('handoff.json'),source=read('component.ui-bundle.json'),appearance=read('appearance-binding.json');
 if(manifest.kind!=='ai_ui_component_handoff_v2'||manifest.human_visual_acceptance!==false)throw Error('VALUE_TEXT_DRAFT_V2_REQUIRED');
 validateValueTextBindings(bindings,source.document);source.document.valueTextBindings=bindings;appearance.documentSha256=await appearanceDocumentSha256(source.document);
 write('component.ui-bundle.json',source);write('appearance-binding.json',appearance);
 if(manifest.runtime_bundle){const runtime=read('runtime.ui-bundle.json');runtime.document.valueTextBindings=bindings;write('runtime.ui-bundle.json',runtime);manifest.runtime_bundle.sha256=await referenceSha256(entries.get('runtime.ui-bundle.json')!);}
 manifest.component_bundle.sha256=await referenceSha256(entries.get('component.ui-bundle.json')!);manifest.appearance_binding.sha256=await referenceSha256(entries.get('appearance-binding.json')!);write('handoff.json',manifest);
 const output=zip(entries);await compileComponentHandoff(output);return output;
}
