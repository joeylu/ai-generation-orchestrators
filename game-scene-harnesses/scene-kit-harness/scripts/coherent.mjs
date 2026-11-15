import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readSelectedFile,parseJson,writeFreshFile} from '../src/files.mjs';
import {check,jsonBytes} from '../src/generation/common.mjs';
import {reviewCoherentStudioRecomposition} from '../src/coherent-recomposition-review.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {TERRAIN_COMPLETION_POLICY} from '../src/terrain-perimeter-contract.mjs';
import {captureCoherentStudio,startCoherentStudio} from '../src/coherent-studio.mjs';
import {createInterface} from 'node:readline/promises';
import {randomUUID} from 'node:crypto';
import {createCoherentImageAdapter} from './coherent-adapter.mjs';
const help=`Coherent reference-led scene pipeline (approximate reconstruction; final art review separate).
init --brief JSON --out NEW_PROJECT [--composition-guide PNG --guide-decision JSON] [--final-review-policy studio-recomposition-required-v1]
inspect|advance --root PROJECT
design --root PROJECT --decisions JSON
compute-review --root PROJECT --out NEW_DIRECTORY
source-review --root PROJECT --out NEW_DIRECTORY [--briefs SUBJECT_SCOPE_OVERRIDES_JSON]
reference-design-preview --root PROJECT --input JSON --out NEW_JSON
reference-design-adopt --root PROJECT --input JSON --decision JSON
coherence-review --root PROJECT --out NEW_DIRECTORY [--observations JSON]
terrain-source-review --root PROJECT --batch-id ID --out NEW_JSON [--manufactured-material-profile reference-defined-manufactured-v1] [--gutter-policy strict]
terrain-freeze --root PROJECT --batch-id ID --proposal-sha SHA256 [--manufactured-material-profile reference-defined-manufactured-v1] [--gutter-policy strict]
surface-review --root PROJECT --observations JSON --out NEW_DIRECTORY [--base-composition JSON] [--terrain-rendering JSON]
border-review --root PROJECT --source PLAN_SHA256 --out NEW_DIRECTORY
border-apply --root PROJECT --review DIRECTORY --decision JSON --preparation-id ID --batch-id ID
canvas-review --root PROJECT --source PLAN_SHA256 --out NEW_DIRECTORY [--profile low-alpha-margin-v2]
canvas-apply --root PROJECT --review DIRECTORY --decision JSON --preparation-id ID --batch-id ID
authorize --root PROJECT --decision JSON
run --root PROJECT --adapter codex | --adapter-module FILE [--planner-module FILE --analysis-id ID]
continue --root PROJECT [--adapter codex | --adapter-module FILE] [--planner-module FILE] [--delivery DIRECTORY --analysis-id ID --studio-port PORT --capture true --browser-channel CHANNEL --defer-source-plan true]
  [--composition JSON | --surface-observations JSON [--terrain-rendering JSON]] [--terrain JSON --band-relations-reviews JSON --band-guide-reviews JSON]
analyze --root PROJECT --planner-module FILE --analysis-id ID
assess --root PROJECT --analysis JSON --out NEW_DIRECTORY
review --root PROJECT --analysis JSON --decision JSON [--defer-source-plan true]
observation-coverage --root PROJECT --observations JSON
late-reuse-preview --root PROJECT --asset ID --out NEW_JSON
late-reuse-adopt --root PROJECT --asset ID --options JSON
revise --root PROJECT --options JSON
reserve --root PROJECT --out NEW_EXCHANGE
receive --root PROJECT --exchange DIRECTORY --file NATIVE_PNG
stop-unknown --root PROJECT --exchange DIRECTORY
band-relations-review --root PROJECT --source PLAN_SHA256 --observations JSON --out NEW_JSON
band-guide-review --root PROJECT --source PLAN_SHA256 --observations JSON --out NEW_JSON
features-review --root PROJECT --composition V6_JSON --out NEW_JSON
deliver --root PROJECT --delivery NEW_DIRECTORY [--composition JSON] [--terrain JSON] [--band-relations-reviews JSON] [--band-guide-reviews JSON]
verify --root PROJECT --delivery DIRECTORY
recomposition-review --root PROJECT --delivery DIRECTORY --capture-dir DIRECTORY --observations JSON --out NEW_JSON
art-review --root PROJECT --delivery DIRECTORY --decision JSON [--capture-dir DIRECTORY --observations JSON --recomposition-report JSON]
studio --root PROJECT --delivery DIRECTORY [--port PORT]
capture --root PROJECT --delivery DIRECTORY --out NEW_DIRECTORY [--browser-channel CHANNEL]
Only run/continue call the explicit image adapter, after digest-bound confirmation. External reserve dispatches no provider call.
soft-composition-v3 requires both guide files on init; importing an accepted guide never authorizes image compute.
analyze invokes one explicitly selected trusted planner for data only; each analysis ID reserves once.
New projects require explicit reference/material surface observations before default delivery; surface-review does no generation.
continue can use checked delivery inputs without a planner or image adapter after sources are ready.
New init requires v2 terrainIntent with explicit material-study or complete-brush usage. Complete brushes require seven role briefs and checked native perimeter delivery; existing project policies remain unchanged.
With the opt-in final review policy, art-review accept requires all three recomposition evidence arguments; reject remains available without them.
studio remains loopback-only and exposes no generation endpoint. No implicit yes, automatic retry, model setup or old-kit borrowing.`;
try{
  const [command,...args]=process.argv.slice(2);if(!command||command==='--help')console.log(help);
  else{
    const allowed={init:['brief','out','composition-guide','guide-decision','final-review-policy'],inspect:['root'],advance:['root'],design:['root','decisions'],'compute-review':['root','out'],'terrain-source-review':['root','batch-id','out','manufactured-material-profile','gutter-policy'],'terrain-freeze':['root','batch-id','proposal-sha','manufactured-material-profile','gutter-policy'],'source-review':['root','out','briefs'],'coherence-review':['root','out','observations'],'surface-review':['root','observations','out','base-composition','terrain-rendering'],authorize:['root','decision'],
      run:['root','adapter','adapter-module','planner-module','analysis-id'],continue:['root','adapter','adapter-module','planner-module','analysis-id','delivery','studio-port','capture','browser-channel','defer-source-plan','composition','surface-observations','terrain-rendering','terrain','band-relations-reviews','band-guide-reviews'],analyze:['root','planner-module','analysis-id'],assess:['root','analysis','out'],review:['root','analysis','decision','defer-source-plan'],'observation-coverage':['root','observations'],
      'reference-design-preview':['root','input','out'],'reference-design-adopt':['root','input','decision'],'late-reuse-preview':['root','asset','out'],'late-reuse-adopt':['root','asset','options'],revise:['root','options'],'border-review':['root','source','out'],'border-apply':['root','review','decision','preparation-id','batch-id'],'canvas-review':['root','source','out','profile'],'canvas-apply':['root','review','decision','preparation-id','batch-id'],reserve:['root','out'],receive:['root','exchange','file'],'stop-unknown':['root','exchange'],
      'band-relations-review':['root','source','observations','out'],'band-guide-review':['root','source','observations','out'],'features-review':['root','composition','out'],deliver:['root','delivery','composition','terrain','band-relations-reviews','band-guide-reviews'],verify:['root','delivery'],'recomposition-review':['root','delivery','capture-dir','observations','out'],'art-review':['root','delivery','decision','capture-dir','observations','recomposition-report'],studio:['root','delivery','port'],capture:['root','delivery','out','browser-channel']}[command];
    check(allowed,'COHERENT_ARGUMENTS');const opts={};
    for(let n=0;n<args.length;n+=2){check(args[n]?.startsWith('--')&&allowed.includes(args[n].slice(2))&&args[n+1]&&!Object.hasOwn(opts,args[n].slice(2)),'COHERENT_ARGUMENTS');opts[args[n].slice(2)]=args[n+1];}
    const optional={init:['composition-guide','guide-decision','final-review-policy'],run:['adapter','adapter-module','planner-module','analysis-id'],continue:command==='continue'?allowed.filter(key=>key!=='root'):[],review:['defer-source-plan'],deliver:['composition','terrain','band-relations-reviews','band-guide-reviews'],studio:['port'],capture:['browser-channel'],'art-review':['capture-dir','observations','recomposition-report'],'source-review':['briefs'],'terrain-source-review':['manufactured-material-profile','gutter-policy'],'terrain-freeze':['manufactured-material-profile','gutter-policy'],'coherence-review':['observations'],'surface-review':['base-composition','terrain-rendering'],'canvas-review':['profile']}[command]??[];
    check(allowed.filter(k=>!optional.includes(k)).every(k=>opts[k]),'COHERENT_ARGUMENTS');
    const read=key=>parseJson(readSelectedFile(opts[key])),root=opts.root;let result;
    if(command==='init'){
      check(Boolean(opts['composition-guide'])===Boolean(opts['guide-decision']),'COHERENT_ARGUMENTS');
      const extra={...(opts['composition-guide']?{compositionGuide:{bytes:readSelectedFile(opts['composition-guide'],16777216),receipt:read('guide-decision')}}:{}),...(opts['final-review-policy']?{finalReviewPolicy:opts['final-review-policy']}:{})};
      result=pipeline.initCoherentPipeline(opts.out,read('brief'),{...extra,terrainIntentPolicy:TERRAIN_COMPLETION_POLICY});
    }
    else if(command==='inspect')result=pipeline.inspectCoherentPipeline(root);
    else if(command==='advance')result=pipeline.advanceCoherentPipeline(root);
    else if(command==='design')result=pipeline.reviewCoherentDesign(root,read('decisions'));
    else if(command==='compute-review')result=pipeline.exportCoherentComputeReview(root,opts.out);
    else if(command==='terrain-source-review'){result=pipeline.previewCoherentTerrainSources(root,opts['batch-id'],opts['manufactured-material-profile'],opts['gutter-policy']);writeFreshFile(opts.out,jsonBytes(result),fileURLToPath(new URL('../',import.meta.url)));}
    else if(command==='terrain-freeze')result=pipeline.freezeCoherentTerrainSources(root,opts['batch-id'],opts['proposal-sha'],opts['manufactured-material-profile'],opts['gutter-policy']);
    else if(command==='source-review')result=pipeline.prepareCoherentSourceScopeReview(root,opts.out,opts.briefs?read('briefs'):null);
    else if(command==='reference-design-preview'){result=pipeline.previewObservedReferenceDesign(root,read('input'));writeFreshFile(opts.out,jsonBytes(result),fileURLToPath(new URL('../',import.meta.url)));}
    else if(command==='reference-design-adopt')result=pipeline.adoptObservedCoherentReferenceDesign(root,read('input'),read('decision'));
    else if(command==='late-reuse-preview'){result=pipeline.previewLateCoherentSourceReuse(root,opts.asset);writeFreshFile(opts.out,jsonBytes(result),fileURLToPath(new URL('../',import.meta.url)));}
    else if(command==='late-reuse-adopt')result=pipeline.adoptLateCoherentSourceReuse(root,opts.asset,read('options'));
    else if(command==='coherence-review')result=pipeline.prepareCoherentVisualReview(root,opts.out,opts.observations?read('observations'):null);
    else if(command==='surface-review')result=pipeline.prepareCoherentSurfaceReview(root,read('observations'),opts.out,{baseComposition:opts['base-composition']?read('base-composition'):null,...(opts['terrain-rendering']?{terrainRendering:read('terrain-rendering')}:{})});
    else if(command==='authorize')result=pipeline.authorizeCoherentStage(root,read('decision'));
    else if(command==='assess')result=pipeline.prepareCoherentReferenceReview(root,read('analysis'),opts.out);
    else if(command==='review'){check(!opts['defer-source-plan']||opts['defer-source-plan']==='true','COHERENT_ARGUMENTS');result=pipeline.reviewCoherentReference(root,read('analysis'),read('decision'),{deferObservationCoverage:opts['defer-source-plan']==='true'});}
    else if(command==='observation-coverage'){result=pipeline.checkCoherentObservationCoverage(root,read('observations'));if(result.status!=='pass')process.exitCode=2;}
    else if(command==='revise')result=pipeline.reviseCoherentStage(root,read('options'));
    else if(command==='border-review')result=pipeline.exportCoherentBorderReview(root,opts.source,opts.out);
    else if(command==='border-apply')result=pipeline.applyCoherentBorderReview(root,opts.review,read('decision'),{preparationId:opts['preparation-id'],batchId:opts['batch-id']});
    else if(command==='canvas-review')result=pipeline.exportCoherentCanvasGutterReview(root,opts.source,opts.out,opts.profile?{profile:opts.profile}:{});
    else if(command==='canvas-apply')result=pipeline.applyCoherentCanvasGutterReview(root,opts.review,read('decision'),{preparationId:opts['preparation-id'],batchId:opts['batch-id']});
    else if(command==='reserve')result=pipeline.reserveCoherentExchange(root,opts.out);
    else if(command==='receive')result=pipeline.receiveCoherentExchange(root,opts.exchange,opts.file);
    else if(command==='stop-unknown')result=pipeline.stopCoherentExchange(root,opts.exchange);
    else if(command==='band-relations-review'){result=(await import('../src/generation/index.mjs')).reviewCoherentBandRelations(join(root,'workflow'),opts.source,read('observations'));writeFreshFile(opts.out,jsonBytes(result),fileURLToPath(new URL('../',import.meta.url)));if(result.status!=='reviewed')process.exitCode=2;}
    else if(command==='band-guide-review'){result=(await import('../src/generation/index.mjs')).reviewCoherentBandGuide(join(root,'workflow'),opts.source,read('observations'));writeFreshFile(opts.out,jsonBytes(result),fileURLToPath(new URL('../',import.meta.url)));if(result.status!=='reviewed')process.exitCode=2;}
    else if(command==='features-review'){const state=pipeline.inspectCoherentPipeline(root);result=(await import('../src/generation/index.mjs')).reviewCoherentReferenceFeatures(join(root,'workflow'),state.batchSha256,read('composition'));writeFreshFile(opts.out,jsonBytes(result),fileURLToPath(new URL('../',import.meta.url)));if(result.status!=='reviewed')process.exitCode=2;}
    else if(command==='deliver')result=pipeline.deliverCoherentPipeline(root,opts.delivery,{composition:opts.composition?read('composition'):null,terrain:opts.terrain?read('terrain'):null,relationReviews:opts['band-relations-reviews']?read('band-relations-reviews'):null,guideReviews:opts['band-guide-reviews']?read('band-guide-reviews'):null});
    else if(command==='verify')result=pipeline.verifyCoherentDelivery(root,opts.delivery);
    else if(command==='recomposition-review'){result=reviewCoherentStudioRecomposition(root,opts.delivery,opts['capture-dir'],read('observations'));writeFreshFile(opts.out,jsonBytes(result),fileURLToPath(new URL('../',import.meta.url)));if(result.status!=='reviewed')process.exitCode=2;}
    else if(command==='art-review'){const count=['capture-dir','observations','recomposition-report'].filter(k=>opts[k]).length;check(count===0||count===3,'COHERENT_ARGUMENTS');result=pipeline.reviewCoherentDelivery(root,opts.delivery,read('decision'),count?{captureDirectory:opts['capture-dir'],observations:read('observations'),recompositionReport:read('recomposition-report')}:{});}
    else if(command==='analyze'){
      const module=await import(pathToFileURL(resolve(opts['planner-module'])).href);check(typeof module.createPlanner==='function','COHERENT_PLANNER_MODULE');
      result=await pipeline.analyzeCoherentReference(root,opts['analysis-id'],await module.createPlanner());
    }else if(command==='run'||command==='continue'){
      const hasAdapter=Boolean(opts.adapter||opts['adapter-module']);
      check(!(opts.adapter&&opts['adapter-module'])&&(!opts.adapter||opts.adapter==='codex')&&(command==='continue'||hasAdapter),'COHERENT_ARGUMENTS');
      if(command==='continue'){
        check((!opts['defer-source-plan']||opts['defer-source-plan']==='true')&&(!opts.capture||opts.capture==='true')&&(!opts['studio-port']||/^\d+$/.test(opts['studio-port'])&&Number(opts['studio-port'])<=65535),'COHERENT_ARGUMENTS');
        check(!(opts.composition&&opts['surface-observations'])&&(!opts['terrain-rendering']||opts['surface-observations']),'COHERENT_ARGUMENTS');
        const delivery=opts.delivery??join(root,'delivery');
        const composition=opts.composition?read('composition'):null,terrain=opts.terrain?read('terrain'):null;
        const relationReviews=opts['band-relations-reviews']?read('band-relations-reviews'):null;
        const guideReviews=opts['band-guide-reviews']?read('band-guide-reviews'):null;
        const observations=opts['surface-observations']?read('surface-observations'):null;
        const calibrationOptions=opts['terrain-rendering']?{terrainRendering:read('terrain-rendering')}:{};
        // A verified completed delivery can be reopened on a host without provider configuration.
        const status=pipeline.inspectCoherentPipeline(root);
        const sourcesReady=status.stage==='ready-to-deliver';
        const adapter=hasAdapter&&!sourcesReady?await createCoherentImageAdapter(root,{adapter:opts.adapter,adapterModule:opts['adapter-module']}):null;
        let planner;
        if(opts['planner-module']&&!sourcesReady){
          const plugin=await import(pathToFileURL(resolve(opts['planner-module'])).href);
          check(typeof plugin.createPlanner==='function','COHERENT_PLANNER_MODULE');planner=await plugin.createPlanner();
        }
        const reader=createInterface({input:process.stdin,output:process.stdout});
        const receipt=(targetSha256,decision,notes)=>({decisionId:'operator.'+randomUUID(),targetSha256,decision,notes});
        const operator={
          async reviewDesign(status){
            console.log(JSON.stringify({spec:parseJson(readSelectedFile(join(root,'spec-draft.json'))),style:parseJson(readSelectedFile(join(root,'style-draft.json'))),policy:pipeline.inspectCoherentPipeline(root).policySha256,
              ...(status.sourcePlanning?{sourcePlanning:status.sourcePlanning}:{})}));
            const expected=`accept-design ${status.design.specSha256} ${status.design.styleSha256}`;
            if(await reader.question(`审阅结构/画风后输入 ${expected}；其他输入停止：`)!==expected)return null;
            return {spec:receipt(status.design.specSha256,'accept','Human operator accepted displayed scene design.'),style:receipt(status.design.styleSha256,'accept','Human operator accepted displayed style.')};
          },
          ...(adapter?{async approveCompute(snapshot){const review=join(root,'compute-review-'+snapshot.targetSha256);pipeline.exportCoherentComputeReview(root,review);
            console.log(JSON.stringify({reviewDirectory:review,targetSha256:snapshot.targetSha256,remainingCalls:snapshot.remainingCalls,plans:snapshot.plans.map(p=>({planSha256:p.sha256,prompt:p.request.prompt,inputs:p.request.images}))}));
            const expected='approve-compute '+snapshot.targetSha256;if(await reader.question(`确认以上准确计划单次计算请输入 ${expected}；其他输入停止：`)!==expected)return null;
            return receipt(snapshot.targetSha256,'approve-compute','Human operator explicitly approved the displayed immutable compute snapshot.');
          }}:{}),
          async reviewReference(analyzed){console.log(JSON.stringify({reviewDirectory:join(root,analyzed.reviewDirectory),packetSha256:analyzed.packet.packetSha256}));
            const sha=analyzed.packet.packetSha256,answer=await reader.question(`查看准确原图与粗布局后输入 accept ${sha} 或 reject ${sha}；其他输入停止：`);
            if(!["accept "+sha,"reject "+sha].includes(answer))return null;
            return receipt(sha,answer.startsWith('accept')?'accept':'reject','Human operator reviewed the exact reference and coarse observed layout.');
          },
          ...(observations!==null?{calibrateSurface:()=>({observations,options:calibrationOptions})}:{})};
        try{result=await pipeline.driveCoherentPipeline(root,{imageAdapter:adapter,planner,operator,analysisId:opts['analysis-id']??'reference',delivery,
          composition,terrain,relationReviews,guideReviews,deferObservationCoverage:opts['defer-source-plan']==='true',onProgress:e=>console.log(JSON.stringify({progress:e}))});}
        finally{reader.close();}
        if(result.delivery&&(opts.capture||opts['studio-port'])){
          const {buildStudio,dependency}=await import('./studio-build.mjs'),{startStudio}=await import('../src/studio/host.mjs');
          if(opts.capture){const {chromium}=dependency('playwright').require('playwright');result.studioCapture=await captureCoherentStudio(root,delivery,join(delivery,'studio-review'),{chromium,buildStudio,startStudio,channel:opts['browser-channel']});}
          if(opts['studio-port']){const host=await startCoherentStudio(root,delivery,{port:Number(opts['studio-port']),buildStudio,startStudio});result.studioUrl=host.url;
            let closing=false;const close=async()=>{if(closing)return;closing=true;await host.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);}
        }
      }else{
        const adapter=await createCoherentImageAdapter(root,{adapter:opts.adapter,adapterModule:opts['adapter-module']});
        if(opts['planner-module']){
          const plugin=await import(pathToFileURL(resolve(opts['planner-module'])).href);check(typeof plugin.createPlanner==='function','COHERENT_PLANNER_MODULE');
          const next=await pipeline.runCoherentStage(root,adapter);
          result=next.stage==='awaiting-reference-review'?await pipeline.analyzeCoherentReference(root,opts['analysis-id']??'reference',await plugin.createPlanner()):next;
        }else result=await pipeline.runCoherentStage(root,adapter);
      }
    }else{
      const {buildStudio,dependency}=await import('./studio-build.mjs'),{startStudio}=await import('../src/studio/host.mjs');
      if(command==='capture'){const {chromium}=dependency('playwright').require('playwright');result=await captureCoherentStudio(root,opts.delivery,opts.out,{chromium,buildStudio,startStudio,channel:opts['browser-channel']});}
      else{check(!opts.port||/^\d+$/.test(opts.port)&&Number(opts.port)<=65535,'COHERENT_ARGUMENTS');
        const host=await startCoherentStudio(root,opts.delivery,{buildStudio,startStudio,port:Number(opts.port??0)});result={status:'local-studio',url:host.url,generationCalls:0};
        let closing=false;const close=async()=>{if(closing)return;closing=true;await host.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);}
    }
    console.log(JSON.stringify(result));
  }
}catch(error){console.error(JSON.stringify({ok:false,code:error.errors?.[0]?.code??'COHERENT_COMMAND_FAILED',message:'Stopped; preserve artifacts and unknown attempts. No automatic retry or fallback.'}));process.exitCode=1;}
