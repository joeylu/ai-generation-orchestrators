// Provider-neutral Node entry. Importing this module never starts generation,
// downloads a browser, loads the Panel SDK, or starts the local Studio server.
import {readFile} from 'node:fs/promises';
export {prepareSkinBatch,verifySkinBatch} from '../scripts/skin-batch.mjs';
export {executeBatch,runAuthorizedBatch,executeBatchPipeline,postprocessBatch} from './skin-generation/batch-runner.mjs';
export {inspectGenerationBatch} from './skin-generation/batch-intake.mjs';
export {prepareSupplement,executeSupplement} from './skin-generation/supplement.mjs';
export {verifySkinPackage} from './skins/package.mjs';
export {inspectConsumer} from './runtime/consumer-tools.mjs';
export {prepareReferencePlan,verifyReferencePlan,executeReference,inspectReference,recoverReferenceReception,reviewReference,prepareComponentsFromReference,executeComponentsFromReference} from './reference-generation/index.mjs';

export async function componentPipelineContract(){
 return JSON.parse(await readFile(new URL('../release/component-contract.json',import.meta.url),'utf8'));
}
