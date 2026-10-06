#!/usr/bin/env node
/** No model: freeze described request variants and their independent assertions. */
import {createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {COLLOQUIAL_SUITE,INCOMPLETE_SUITE} from '../examples/real-input-evaluation-v1/suite.mjs';
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('INPUT_SUITE_ARGUMENTS');
const output=await createOutputDirectory(args[1]);await writeNewJson(output,'colloquial-suite.json',COLLOQUIAL_SUITE);await writeNewJson(output,'incomplete-suite.json',INCOMPLETE_SUITE);
console.log(JSON.stringify({status:'PREPARED',colloquial:16,incomplete:16,modelCalls:0}));
