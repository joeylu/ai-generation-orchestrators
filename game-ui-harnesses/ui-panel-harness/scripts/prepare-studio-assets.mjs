#!/usr/bin/env node
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { prepareStudioAssets } from './lib/prepare-studio-assets.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { canonicalJson } from '../src/canonical.mjs';
try {
  const args=process.argv.slice(2),values={},allowed=['--source','--output','--sharp-module'];
  for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(values,args[i]))throw new Error('CORE_ASSET_ARGUMENTS');values[args[i]]=args[i+1];}
  if(!values['--source']||!values['--output'])throw new Error('CORE_ASSET_ARGUMENTS');
  const report=await prepareStudioAssets(values['--source'],values['--output'],await loadTextureImageAdapter(values['--sharp-module']));
  // Evidence is separate from the immutable library; its delivery manifest is never edited.
  await writeFile(resolve(values['--output']+'.selection.json'),canonicalJson(report)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:'COMPLETE',...report}));
}catch(error){const code=/^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)?error.message:'CORE_ASSET_PREPARATION_FAILED';console.error(JSON.stringify({status:'FAIL',code,modelCalls:0}));process.exitCode=1;}
