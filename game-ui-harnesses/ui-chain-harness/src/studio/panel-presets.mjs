import {referencePresetList,referencePreset} from '../panel/reference-presets.mjs';
import {customPanelChoice} from '../panel/custom-panel.mjs';
import {inventoryModelChoice} from '../panel/inventory-model-request.mjs';
export function studioPanelPresets(snapshot){
 const presets=[...referencePresetList().map(p=>({...p,sourceSha256:referencePreset(p.id).sourceSha256})),inventoryModelChoice];
 snapshot.files.set('panel-presets.json',Buffer.from(JSON.stringify({version:'1.0',presets,custom:customPanelChoice})));
}
