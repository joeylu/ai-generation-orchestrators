import {readFile} from 'node:fs/promises';

export function validateGenerationExecutionPolicy(value){
  if(value?.kind!=='ui_skin_generation_execution_policy'||value.version!=='1.0'||![1,2].includes(value.maxConcurrentSheets))throw Error('batch-runner.invalid-execution-policy');
  return Object.freeze({kind:value.kind,version:value.version,maxConcurrentSheets:value.maxConcurrentSheets});
}
// Studio and the Codex CLI read the same bounded policy at startup. Generic adapters opt in separately.
export const generationExecutionPolicy=validateGenerationExecutionPolicy(JSON.parse(await readFile(new URL('../../configs/skin-generation-execution.json',import.meta.url),'utf8')));
