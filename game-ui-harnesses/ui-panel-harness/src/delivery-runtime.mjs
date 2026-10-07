/** Public browser adapter bundled once; no auto-start, requests or UI ownership. */
import {createPanelHost} from './panel-host.mjs';
import {pixiPanelCore,mountPixiPanelInstance} from './pixi-panel-instance.mjs';
import {validatePanelBundle} from './panel-bundle.mjs';
export {attachPanelGameBinding,validateGameBinding} from './game-binding.mjs';
export {createMemoryGamePort} from './game-port.mjs';
export const version='0.1.0';
export const validateBundle=input=>validatePanelBundle(input,pixiPanelCore);
export const createPixiPanelHost=(options={})=>createPanelHost({...options,core:pixiPanelCore,mount:mountPixiPanelInstance});
