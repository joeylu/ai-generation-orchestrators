import { join } from 'node:path';
import * as flow from '../src/generation/index.mjs';
import * as paint from '../src/reference-paint-pipeline.mjs';
import { validatePaintDesignPacket } from '../src/generation/reference-paint.mjs';
import { validateMaterialDesignPacket } from '../src/generation/reference-paint-material.mjs';
import { parseJson, readSelectedFile } from '../src/files.mjs';
import { check } from '../src/generation/common.mjs';

// Explicit local file commands only; no HTTP endpoint, provider discovery or implicit generation.
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help') console.log('paint-source import-design|review-design|plan|inspect|source-review|application-proposal|review-application|derive|verify-derived\nMaterial v26: import-material-design|review-material-design|material-plan|coverage-proposal|review-coverage\n--workflow DIR; import-design/import-material-design --options JSON --artifacts DIR; review-design/review-material-design --controls SHA --receipt JSON; plan/material-plan --options JSON --out NEW_DIR; inspect --plan SHA; source-review/derive/verify-derived --plan SHA --out DIR; application-proposal/coverage-proposal --plan SHA; review-application --plan SHA --receipt JSON; review-coverage --plan SHA --options OBSERVATION_JSON --receipt JSON\nNo command submits provider jobs. Use the existing workflow external-exchange commands or an explicitly selected adapter API after separate compute approval.');
  else {
    const options = {};
    for (let n = 0; n < args.length; n += 2) {
      check(['--workflow','--options','--artifacts','--controls','--receipt','--plan','--out'].includes(args[n]) && args[n+1]
        && !Object.hasOwn(options,args[n]), 'PAINT_CLI_ARGUMENTS'); options[args[n]] = args[n+1];
    }
    const allowed = { 'import-design':['--workflow','--options','--artifacts'], 'review-design':['--workflow','--controls','--receipt'],
      plan:['--workflow','--options','--out'], inspect:['--workflow','--plan'], 'source-review':['--workflow','--plan','--out'],
      'application-proposal':['--workflow','--plan'], 'review-application':['--workflow','--plan','--receipt'],
      derive:['--workflow','--plan','--out'], 'verify-derived':['--workflow','--plan','--out'],
      'import-material-design':['--workflow','--options','--artifacts'], 'review-material-design':['--workflow','--controls','--receipt'],
      'material-plan':['--workflow','--options','--out'], 'coverage-proposal':['--workflow','--plan'],
      'review-coverage':['--workflow','--plan','--options','--receipt'] }[command];
    check(allowed && allowed.length === Object.keys(options).length && allowed.every(k=>options[k]), 'PAINT_CLI_ARGUMENTS');
    const read = p => parseJson(readSelectedFile(p)), root = options['--workflow']; let result;
    if(command==='import-material-design') {
      const config=read(options['--options']),p=validateMaterialDesignPacket(config.reviewPacket);
      result=flow.importMaterialPaintControls(root,config,new Map(p.artifacts.map(a=>[a.path,readSelectedFile(join(options['--artifacts'],a.path),16777216)])));
    } else if(command==='review-material-design') result=flow.reviewMaterialPaintControls(root,options['--controls'],read(options['--receipt']));
    else if(command==='material-plan') {
      const config=read(options['--options']); paint.buildMaterialPaintProposal(root,config,options['--out']);
      paint.verifyMaterialPaintProposal(root,config,options['--out']); result=flow.freezeMaterialPaintPlan(root,config);
    } else if(command==='coverage-proposal') result=flow.getMaterialCoverageProposal(root,options['--plan']);
    else if(command==='review-coverage') result=flow.reviewMaterialCoverage(root,options['--plan'],read(options['--options']),read(options['--receipt']));
    else if (command === 'import-design') {
      const config = read(options['--options']), p = validatePaintDesignPacket(config.reviewPacket);
      const artifacts = new Map(p.artifacts.map(a=>[a.path,readSelectedFile(join(options['--artifacts'],a.path),16777216)]));
      result = flow.importPaintControls(root,config,artifacts);
    } else if (command === 'review-design') result = flow.reviewPaintControls(root,options['--controls'],read(options['--receipt']));
    else if (command === 'plan') {
      const config=read(options['--options']); paint.buildPaintSourceProposal(root,config,options['--out']);
      paint.verifyPaintSourceProposal(root,config,options['--out']); result=flow.freezePaintSourcePlan(root,config);
    } else if (command === 'inspect') result=paint.inspectPaintSource(root,options['--plan']);
    else if (command === 'source-review') result=flow.buildPaintSourceReview(root,options['--plan'],options['--out']);
    else if (command === 'application-proposal') result=flow.getPaintApplicationProposal(root,options['--plan']);
    else if (command === 'review-application') result=flow.reviewPaintApplication(root,options['--plan'],read(options['--receipt']));
    else if (command === 'derive') result=flow.buildPaintLayer(root,options['--plan'],options['--out']);
    else result=flow.verifyPaintLayer(root,options['--plan'],options['--out']);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(JSON.stringify({ok:false,code:error.errors?.[0]?.code??'PAINT_COMMAND_FAILED',message:'Stopped; preserve evidence. No automatic retry or provider submission.'}));process.exitCode=1;
}
