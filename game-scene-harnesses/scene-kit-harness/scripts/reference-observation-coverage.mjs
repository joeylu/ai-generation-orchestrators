import {checkReferenceObservationCoverage} from '../src/generation/reference-observation-coverage.mjs';
import {check,exact} from '../src/generation/common.mjs';
import {parseJson,readSelectedFile} from '../src/files.mjs';

const help='Usage: node scripts/reference-observation-coverage.mjs --input LOCAL_JSON --reference LOCAL_PNG\n       node scripts/reference-observation-coverage.mjs --requirements LOCAL_JSON --scopes LOCAL_JSON --observations LOCAL_JSON --reference LOCAL_PNG\nChecks explicit observations and source assignments only. No generation, image recognition or art acceptance.';
try {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help')console.log(help);
  else {
    const opts={};for(let i=0;i<args.length;i+=2){check(['--input','--requirements','--scopes','--observations','--reference'].includes(args[i])&&args[i+1]&&!Object.hasOwn(opts,args[i]),'OBSERVATION_ARGUMENTS');opts[args[i]]=args[i+1];}
    check(opts['--reference']&&(args.length===4&&opts['--input']||args.length===8&&opts['--requirements']&&opts['--scopes']&&opts['--observations']),'OBSERVATION_ARGUMENTS');
    let data;
    if(opts['--input']){data=parseJson(readSelectedFile(opts['--input'],2097152));exact(data,['requirements','sourceScopes','requiredObservationIds','observations','assignments']);}
    else {const observations=parseJson(readSelectedFile(opts['--observations'],2097152));exact(observations,['requiredObservationIds','observations','assignments']);
      data={requirements:parseJson(readSelectedFile(opts['--requirements'],2097152)),sourceScopes:parseJson(readSelectedFile(opts['--scopes'],2097152)),...observations};}
    const report=checkReferenceObservationCoverage({...data,referenceBytes:readSelectedFile(opts['--reference'],16777216)});
    console.log(JSON.stringify(report));if(report.status!=='pass')process.exitCode=2;
  }
} catch(error) {console.error(JSON.stringify({ok:false,code:error.errors?.[0]?.code??'OBSERVATION_COVERAGE_FAILED',generationCalls:0}));process.exitCode=1;}
