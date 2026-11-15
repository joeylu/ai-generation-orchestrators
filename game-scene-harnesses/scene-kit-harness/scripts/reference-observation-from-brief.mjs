// Offline preflight template for a new scoped coherent plan. It is not an
// image recognizer, a workflow mutation, a compute authorization, or a review.
import {createLayerSourceScopes} from '../src/generation/layer-source.mjs';
import {checkReferenceObservationCoverage} from '../src/generation/reference-observation-coverage.mjs';
import {check,exact,seal} from '../src/generation/common.mjs';
import {parseJson,readSelectedFile} from '../src/files.mjs';
const help='Usage: node scripts/reference-observation-from-brief.mjs --brief LOCAL_JSON --observations LOCAL_JSON --reference LOCAL_PNG\nZero generation. The returned sourceScopes must be the exact scopes passed to source planning; rerun after changes.';
try {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help')console.log(help);
  else {
    const opts={};for(let i=0;i<args.length;i+=2){check(['--brief','--observations','--reference'].includes(args[i])&&args[i+1]&&!Object.hasOwn(opts,args[i]),'OBSERVATION_ARGUMENTS');opts[args[i]]=args[i+1];}
    check(args.length===6&&opts['--brief']&&opts['--observations']&&opts['--reference'],'OBSERVATION_ARGUMENTS');
    const brief=parseJson(readSelectedFile(opts['--brief'],2097152)),data=parseJson(readSelectedFile(opts['--observations'],2097152));
    exact(data,['requiredObservationIds','observations','assignments']);
    check(brief?.requirements&&Array.isArray(brief.sourceScopes)&&!Object.hasOwn(brief.requirements,'sha256'),'OBSERVATION_BRIEF');
    const requirements=seal(brief.requirements),sourceScopes=createLayerSourceScopes(requirements,brief.sourceScopes);
    const report=checkReferenceObservationCoverage({...data,requirements,sourceScopes,referenceBytes:readSelectedFile(opts['--reference'],16777216)});
    console.log(JSON.stringify({requirements,sourceScopes,report}));if(report.status!=='pass')process.exitCode=2;
  }
}catch(error){console.error(JSON.stringify({ok:false,code:error.errors?.[0]?.code??'OBSERVATION_COVERAGE_FAILED',generationCalls:0}));process.exitCode=1;}
