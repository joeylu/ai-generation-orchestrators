import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as flow from '../../src/generation/index.mjs';
import * as pipeline from '../../src/reference-paint-pipeline.mjs';
import * as project from '../../src/reference-led-pipeline.mjs';
import { PAINT_DESIGN_FILES, assessPaintSource } from '../../src/generation/reference-paint.mjs';
import { compilePaintGeometryDesign, paintGeometryGuide } from '../../src/reference-paint-design.mjs';
import { inspectPng, encodeRgbaPng } from '../../src/png.mjs';
import { raster } from '../../src/terrain-proof/raster.mjs';
import { seal, unseal, hash, jsonBytes } from '../../src/generation/common.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './reference-controls.mjs';
import { decision } from './generation.mjs';
export function fixture(t,{accept=true}={}) {
  const f=controlFixture(t,{rejected:false});
  const observation=controlMeasurement(f.baseline,f.result.rawSha256),packet=flow.buildMeasuredReferenceReview(f.workflow,f.baseline.sha256,observation,join(f.parent,'actual'));
  flow.reviewMeasuredReference(f.workflow,f.baseline.sha256,observation,decision('paint.target.accept',packet.packetSha256));
  const target=flow.getReferenceReconstructionTarget(f.workflow,f.baseline.sha256),raw=syntheticControlImage(),mask=raster(128,100);
  for(let y=25;y<100;y++)for(let x=0;x<96;x++)if(!(x>=20&&x<29&&y>=40&&y<46))mask.rgba.set([255,255,255,x===1&&y===25?128:255],(y*128+x)*4);
  for(let y=8;y<26;y++)for(let x=30;x<35;x++)mask.rgba.set([255,255,255,255],(y*128+x)*4);
  const alpha=encodeRgbaPng(128,100,mask.rgba);
  const g=seal({format:'ai_scene_geometry_design_target_v1',sourcePacketSha256:hash(Buffer.from('synthetic prior shape review')),sourceDraftSha256:hash(Buffer.from('synthetic vector')),
    alphaPngSha256:hash(alpha),alphaRgbaSha256:hash(mask.rgba),instanceId:'ground.actual',referenceSha256:hash(raw),targetSha256:target.sha256,
    nativeFrame:{width:512,height:288},localCanvas:{width:128,height:100},origin:{x:0,y:188},frameClippedEdges:['left','bottom'],originalUncertainPixels:17,opticalAlphaMeasured:false});
  const geometryReview=seal({format:'ai_scene_geometry_design_acceptance_v1',geometryPacketSha256:g.sourcePacketSha256,alphaPngSha256:hash(alpha),decision:'accept',scope:'geometry-design-target-only',
    provenance:'synthetic-test-fixture',recordedOn:'2026-10-26',userReply:'synthetic geometry choice',computeAuthorized:false,realImageApplicationAuthorized:false});
  const brief=seal({format:'ai_scene_paint_brief_v1',subject:'synthetic ground',appearance:'varied synthetic blocks',exclusions:['sky'],intent:'Keep the original left and bottom frame cuts.'});
  const guide=paintGeometryGuide(alpha),design=compilePaintGeometryDesign(g,alpha,geometryReview,{geometryGuide:guide,appearanceReference:raw},brief);
  const artifacts=new Map([['geometry-design-target.json',jsonBytes(g)],['geometry-acceptance.json',jsonBytes(geometryReview)],['geometry-alpha.png',alpha],
    ['paint-guide.png',guide],['reference-native.png',raw],['paint-brief.json',jsonBytes(brief)],['proposal.json',jsonBytes(design)],['source-prompt-draft.txt',Buffer.from(design.sourcePaintDraft.prompt+'\n')]]);
  const reviewPacket=seal({format:'ai_scene_paint_design_control_packet_v1',sourceReviewPacketSha256:hash(Buffer.from('synthetic full design review')),
    proposalSha256:design.sha256,artifacts:PAINT_DESIGN_FILES.map(path=>({path,sha256:hash(artifacts.get(path)),byteLength:artifacts.get(path).length})),computeAuthorized:false,realApplicationAuthorized:false});
  const importOptions={controlId:'paint.synthetic',referencePlanSha256:f.baseline.sha256,reviewPacket};
  const c=flow.importPaintControls(f.workflow,importOptions,artifacts);
  if(accept)flow.reviewPaintControls(f.workflow,c.sha256,decision('paint.design.accept',design.sha256));
  const options={planId:'paint.first',parents:[],capabilitiesSha256:f.cap.sha256,paintControlsSha256:c.sha256};
  return {...f,target,raw,mask,alpha,guide,design,artifacts,reviewPacket,importOptions,c,options};
}
export function generated({width=256,height=200,transparent=false,blank=false}={}) {
  const image=raster(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)image.rgba.set([blank?40:40+x%51,80+y%29,130,transparent&&x<10?0:255],(y*width+x)*4);
  if(transparent)for(let y=0;y<height;y++)for(let x=0;x<10;x++)image.rgba.fill(0,(y*width+x)*4,(y*width+x)*4+4);
  if(blank)for(let i=0;i<width*height;i++)image.rgba.set([40,80,130,255],i*4);
  return encodeRgbaPng(width,height,image.rgba);
}
