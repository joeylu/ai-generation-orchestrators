import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {componentPipelineDirectory,componentPipelineBrowser,checkComponentPipeline} from '../scripts/component-pipeline-check.mjs';

test('component acceptance cannot write to the workspace root, sibling harnesses or paths outside work',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 for(const value of ['.','work','../ui-panel-harness/work/fixture','work/../../escaped'])assert.throws(()=>componentPipelineDirectory(value),/WORK_PATH_REQUIRED/);
 assert.equal(componentPipelineDirectory('work/component-pipeline-check/example'),join(root,'work/component-pipeline-check/example'));
});
test('component acceptance rejects unsupported browsers and invalid material flags before creating inputs',async()=>{
 for(const value of ['firefox','../../browser',''])assert.throws(()=>componentPipelineBrowser(value),/BROWSER_INVALID/);
 for(const value of ['chromium','chrome','msedge'])assert.equal(componentPipelineBrowser(value),value);
 await assert.rejects(()=>checkComponentPipeline({materials:'true'}),/MATERIALS_INVALID/);
 await assert.rejects(()=>checkComponentPipeline({browser:'firefox'}),/BROWSER_INVALID/);
});
