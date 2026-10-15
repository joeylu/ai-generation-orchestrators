// Retired: real compute is confirmed against the current immutable plan in Studio.
const help=process.argv.length===2||process.argv.slice(2).every(value=>['--help','help'].includes(value));
console.log(JSON.stringify({status:'retired',code:'STUDIO_REAL_ACCEPTANCE_RETIRED',modelCalls:0,message:'Use the current local Studio UI and docs/acceptance.md. This historical script never starts or continues generation; command-line confirmation flags are not authorization.'}));
if(!help)process.exitCode=1;
