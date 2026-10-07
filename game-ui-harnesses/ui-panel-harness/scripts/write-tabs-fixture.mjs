#!/usr/bin/env node
/** Explicit deterministic fixture producer; performs no model or native Editor calls. */
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {tabsRequest,tabsIntent} from '../examples/tabs-v1/fixture.mjs';
try{
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('TABS_FIXTURE_ARGUMENTS');
 const catalog=await readJson(new URL('../examples/modern-mint-tabs.catalog.json',import.meta.url)),context=await createPlanningContext(tabsRequest,catalog);
 const proposal=await materializePanelIntent(context,tabsIntent(context)),core=await loadWorkspaceCore(),bundle=await validatePanelBundle(await createPanelBundle(proposal.spec,catalog,core),core);
 const output=await createOutputDirectory(args[1]);for(const [name,value]of Object.entries({'planning-context.json':context,'proposal.json':proposal,'panel.bundle.json':bundle}))await writeNewJson(output,name,value);
 console.log(JSON.stringify({status:'TABS_FIXTURE_WRITTEN',bundleSha256:bundle.sha256,modelCalls:0}));
}catch(error){console.error(JSON.stringify({status:'FAIL',code:error.code??'TABS_FIXTURE_FAILED'}));process.exitCode=1;}
