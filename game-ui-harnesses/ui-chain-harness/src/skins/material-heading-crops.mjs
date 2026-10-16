import {locateSheet} from './locate.mjs';
import {associateSheet} from './associate.mjs';
import {assertSeparatedCrops} from './proposal-crops.mjs';
import policy from '../../configs/skin-localization-policy.json' with {type:'json'};

// S05 versions through 1.2 replay their retained legacy weak attachment policy.
const {boundedWeakAttachments:_boundedWeakAttachments,...headingPolicy}=policy;

const contains=(a,b)=>b[0]>=a[0]&&b[1]>=a[1]&&b[0]+b[2]<=a[0]+a[2]&&b[1]+b[3]<=a[1]+a[3];

// Semantic slots identify the heading, while unambiguous separated source
// components define its full contour. Tile materials keep their interior sample.
export function materialHeadingCrops(image,geometry){
 let location;
 try{location=locateSheet(image,{id:'S05',parts:geometry.parts},geometry.coordinates);}
 catch(error){if(error.message==='locate.overlapping-slots')return new Map();throw error;}
 const association=associateSheet(image,location,headingPolicy);
 if(association.parts.length!==geometry.parts.length)return new Map();
 try{assertSeparatedCrops(association.parts);}catch{return new Map();}
 return new Map(association.parts.filter(p=>geometry.parts.find(d=>d.assetId===p.assetId)?.stretch==='horizontal').map(p=>[p.assetId,{
  crop:p.proposedCrop,evidence:{method:'unique-separated-slot-components-v1',policy:structuredClone(headingPolicy),anchorComponentIds:p.anchorComponentIds,
   attachedWeakComponentIds:p.attachedWeakComponentIds,attachedFringeComponentIds:p.attachedFringeComponentIds??[],issues:p.issues}
 }]));
}

export function completeHeadingCrop(fixed,candidate){
 return candidate&&!contains(fixed,candidate.crop)?{crop:candidate.crop,evidence:{...candidate.evidence,templateBodyCrop:fixed}}:{crop:fixed};
}
