import {selectOptionIconsFixture} from './select-option-icons-fixture.ts';
import {zip,referenceSha256} from '../../src/reference-persistence.ts';
import type {SelectMenuHighlights} from '../../src/select-menu-highlights.ts';
export const fixtureMenuHighlights:SelectMenuHighlights={version:'1.0',coordinateSpace:'popup-row-local',selected:{color:'#2040C0',alpha:0.5,insets:{top:4,right:4,bottom:4,left:4},cornerRadius:6},hover:{color:'#C04020',alpha:0.25,insets:{top:4,right:4,bottom:4,left:4},cornerRadius:6}};
export async function selectMenuHighlightsFixture(){
 const f=await selectOptionIconsFixture();f.binding.bindings[2].states.select.menuHighlights=structuredClone(fixtureMenuHighlights);
 const enc=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
 f.entries.set('appearance-binding.json',enc(f.binding));const manifest=JSON.parse(new TextDecoder().decode(f.entries.get('handoff.json')));
 manifest.appearance_binding.sha256=await referenceSha256(f.entries.get('appearance-binding.json')!);f.entries.set('handoff.json',enc(manifest));
 return {...f,zip:zip(f.entries)};
}
