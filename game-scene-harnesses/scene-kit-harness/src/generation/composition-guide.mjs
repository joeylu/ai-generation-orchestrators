import {validateReferenceRequirements} from '../reference-measurement.mjs';
import {check,digest,exact,id,imageRef,isDigest,receipt,seal,unseal} from './common.mjs';

export const COMPOSITION_GUIDANCE_PROFILE='soft-composition-v3';
export const COMPOSITION_GUIDE_PURPOSE='relative-position-and-occlusion-only-not-style-or-pixel-lock';
const imageOptions={allowCabx:true,allowHiddenRgb:true};

function specAt(state,sha256){
  check(isDigest(sha256),'COMPOSITION_GUIDE_SPEC');
  const spec=state.designs.get(sha256);check(spec?.format==='ai_scene_spec_v3'&&spec.sha256===sha256,'COMPOSITION_GUIDE_SPEC');
  unseal(spec);validateReferenceRequirements(spec.requirements);return spec;
}
function acceptedReceipt(value,image){
  receipt(value,'review');
  check(value.decision==='accept'&&value.targetSha256===image.sha256,'COMPOSITION_GUIDE_ACCEPTANCE');
}

// Importing an already reviewed guide binds the existing draft, not active
// artwork or compute. The model owns decision-ID use and the durable event.
export function compileCompositionGuide(state,options,bytes){
  exact(options,['guideId','specSha256','receipt']);id(options.guideId);
  const spec=specAt(state,options.specSha256),image=imageRef(bytes,imageOptions);
  acceptedReceipt(options.receipt,image);
  return seal({format:'ai_scene_coherent_composition_guide_v1',guideId:options.guideId,specSha256:spec.sha256,
    requirementsSha256:spec.requirements.sha256,image,purpose:COMPOSITION_GUIDE_PURPOSE,receipt:options.receipt,
    sourcePngModified:false,generationCalls:0});
}

export function validateCompositionGuide(state,record,readBlob){
  const body=unseal(record);exact(body,['format','guideId','specSha256','requirementsSha256','image','purpose','receipt','sourcePngModified','generationCalls']);
  id(body.guideId);const spec=specAt(state,body.specSha256);
  check(body.format==='ai_scene_coherent_composition_guide_v1'&&body.requirementsSha256===spec.requirements.sha256
    &&body.purpose===COMPOSITION_GUIDE_PURPOSE&&body.sourcePngModified===false&&body.generationCalls===0,'COMPOSITION_GUIDE_BINDING');
  exact(body.image,['sha256','byteLength','pixelSize']);exact(body.image.pixelSize,['width','height']);
  check(isDigest(body.image.sha256)&&Number.isSafeInteger(body.image.byteLength)&&body.image.byteLength>0&&body.image.byteLength<=16777216
    &&Object.values(body.image.pixelSize).every(value=>Number.isSafeInteger(value)&&value>0&&value<=4096),'COMPOSITION_GUIDE_IMAGE');
  acceptedReceipt(body.receipt,body.image);
  if(readBlob!==undefined){
    check(typeof readBlob==='function','COMPOSITION_GUIDE_BLOB_REQUIRED');
    const replay=compileCompositionGuide(state,{guideId:body.guideId,specSha256:body.specSha256,receipt:body.receipt},readBlob(body.image.sha256));
    check(replay.sha256===record.sha256&&digest(replay.image)===digest(body.image),'COMPOSITION_GUIDE_IMAGE');
  }
  return body;
}
