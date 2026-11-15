import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as reference from '../../src/reference-led-pipeline.mjs';
import * as flow from '../../src/generation/index.mjs';
import {REFERENCE_STANDARDS} from '../../src/reference-measurement.mjs';
import {encodeRgbaPng} from '../../src/png.mjs';
import {seal,hash} from '../../src/generation/common.mjs';
import {decision} from './generation.mjs';
export const coherentBrief=(theme='Desert sandstone city')=>({projectId:'coherent.fixture',description:theme,
  viewport:{width:256,height:144},maxAspectErrorPermille:5,inputs:[],style:{mode:'preset',preset:'clean-handpaint',name:'',rules:[],anchorPath:null},
  requirements:seal({format:'ai_scene_reference_requirements_v1',requirementsId:'coherent.requirements',
    layers:[{layerId:'sky',kind:'background',zIndex:0,parallaxX:0},{layerId:'landmark',kind:'environment',zIndex:10,parallaxX:.3},
      {layerId:'ground',kind:'terrain',zIndex:20,parallaxX:1},{layerId:'platform',kind:'terrain',zIndex:30,parallaxX:1},{layerId:'front',kind:'foreground',zIndex:40,parallaxX:1.1}],
    subjects:[{subjectId:'sky',role:'sky',layerId:'sky',content:theme+' sky only',count:{min:1,max:1},placementHint:'wide'},
      {subjectId:'landmark',role:'landmark',layerId:'landmark',content:theme+' distant landmark with supporting foundation',count:{min:1,max:1},placementHint:'right'},
      {subjectId:'ground',role:'ground',layerId:'ground',content:theme+' solid ground',count:{min:1,max:1},placementHint:'left'},
      {subjectId:'platform',role:'platform',layerId:'platform',content:theme+' solid floating platform',count:{min:1,max:1},placementHint:'center'},
      {subjectId:'foreground',role:'foreground',layerId:'front',content:theme+' framing rocks',count:{min:2,max:2},placementHint:'frame-edges'}],
    compositionNotes:['Overall theme and style coherence; no pixel-exact reconstruction required.'],
    standards:REFERENCE_STANDARDS.map(key=>({key,requirement:'Fixture '+key}))})});
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
export function coherentAnalysis(plan,rawSha256,requirements){
  const rows=[['sky.actual','sky','sky',0,0,256,144],['landmark.actual','landmark','landmark',145,10,95,60],
    ['ground.actual','ground','ground',0,90,70,54],['platform.actual','platform','platform',110,80,60,25],
    ['front.left','foreground','front',0,105,50,39],['front.right','foreground','front',220,102,36,42]];
  return seal({format:'ai_scene_measured_reference_layout_v1',planSha256:plan.sha256,rawSha256,coordinates:'canonical-reference-frame',layers:requirements.layers,
    instances:rows.map(([instanceId,subjectId,layerId,x,y,w,h])=>({instanceId,subjectId,layerId,visibleEnvelope:rect(x,y,w,h),anchor:{x:x+w/2,y:y+h/2},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic coarse observed envelope, not an Alpha mask.'})),
    surfaces:[{surfaceId:'ground.surface',instanceId:'ground.actual',points:[{x:0,y:95},{x:70,y:95}],evidence:'observed',notes:'Synthetic observed surface.'},
      {surfaceId:'platform.surface',instanceId:'platform.actual',points:[{x:110,y:82},{x:170,y:82}],evidence:'observed',notes:'Synthetic platform surface.'}],
    quality:REFERENCE_STANDARDS.map(key=>({key,verdict:'pass',notes:'Synthetic fixture visual decision.'}))});
}
export function sourcePng(alpha=false,seed=0){
  const width=1024,height=512,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!alpha||(x>=100&&x<924&&y>=90&&y<450))rgba.set([40+(x+seed)%130,75+(y+seed)%90,110+seed%30,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}
export function referencePng(){const rgba=Buffer.alloc(512*288*4,255);for(let i=0;i<512*288;i++)rgba[i*4]=(i+9)%230;return encodeRgbaPng(512,288,rgba);}
export function coherentSurfaceObservations(){return {format:'ai_scene_measured_surface_observations_v1',
  sourceSurfaceTopY:40,sourceBodyStartY:64,sourceWindowCenterX:512,
  rockFeaturePairs:[{featureId:'synthetic.rock',source:{fromX:100,toX:140},reference:{fromX:80,toX:140}}],
  referenceSurfaceSamples:[{sampleId:'synthetic.surface',surfaceId:'ground.surface',x:10,topY:190,bodyStartY:214}],
  notes:'Synthetic explicit observations for offline calibration tests; not image analysis or human art acceptance.'};}
export function setupCoherent(t,theme,description,{transformBrief=b=>b,transformAnalysis=a=>a,referenceBytes=null}={}){
  const parent=mkdtempSync(join(tmpdir(),'coherent-scene-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const root=join(parent,'project'),brief=transformBrief(coherentBrief(theme));
  if(description!==undefined)brief.description=description;
  const status=reference.initReferenceLedProject(root,brief,{purpose:'synthetic-simulation'}),workflow=join(root,'workflow');
  reference.reviewReferenceLedDesign(root,{spec:decision('design.spec',status.design.specSha256),style:decision('design.style',status.design.styleSha256)});
  reference.planReferenceLedProject(root);const ref=reference.inspectReferenceLedProject(root).reference;
  const plan=flow.getGenerationPlan(workflow,ref.planSha256);flow.authorizePlan(workflow,plan.sha256,decision('reference.compute',plan.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(workflow,plan.sha256);flow.recordSubmission(workflow,ticket);
  const raw=referenceBytes??referencePng();flow.receiveResult(workflow,ticket,raw);
  const analysis=transformAnalysis(coherentAnalysis(plan,hash(raw),brief.requirements)),packet=flow.buildMeasuredReferenceReview(workflow,plan.sha256,analysis,join(parent,'reference-review'));
  flow.reviewMeasuredReference(workflow,plan.sha256,analysis,decision('reference.accept',packet.packetSha256));
  return {root,parent,workflow,plan,raw,brief,status,target:flow.getReferenceReconstructionTarget(workflow,plan.sha256),
    options:{batchId:'coherent.sources',referencePlanSha256:plan.sha256,capabilitiesSha256:JSON.parse(requireText(root,'capabilities.json')).sha256}};
}
import {readFileSync} from 'node:fs';
const requireText=(root,name)=>readFileSync(join(root,name),'utf8');
