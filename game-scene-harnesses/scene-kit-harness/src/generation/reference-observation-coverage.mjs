import {check,digest,exact,hash,id,seal,text,unseal} from './common.mjs';
import {LAYER_SOURCE_POLICY,validateLayerSourceScopes} from './layer-source.mjs';

// Explicit author/Agent observations and assignments are data, not vision or
// semantic inference. An independent checklist can identify a missing declared
// observation, but cannot discover details absent from both lists.
export function checkReferenceObservationCoverage({referenceBytes,requirements,sourceScopes,requiredObservationIds,observations,assignments}) {
  check(referenceBytes instanceof Uint8Array&&referenceBytes.length>0&&referenceBytes.length<=16777216,'OBSERVATION_REFERENCE');
  const referenceRawSha256=hash(referenceBytes);
  unseal(requirements);const scopes=validateLayerSourceScopes(requirements,sourceScopes);
  check(Array.isArray(requiredObservationIds)&&requiredObservationIds.length>0&&requiredObservationIds.length<=96
    &&Array.isArray(observations)&&observations.length<=96&&Array.isArray(assignments)&&assignments.length<=192,'OBSERVATION_LIMIT');
  const required=new Set(),observed=new Map(),seenAssignments=new Set();
  for(const key of requiredObservationIds){id(key);check(!required.has(key),'OBSERVATION_DUPLICATE');required.add(key);}
  for(const row of observations){exact(row,['observationId','description','layerId','parentRole']);
    id(row.observationId);id(row.layerId);text(row.description,{limit:1200});
    check(LAYER_SOURCE_POLICY.parentRoles.includes(row.parentRole),'OBSERVATION_PARENT');
    check(!observed.has(row.observationId),'OBSERVATION_DUPLICATE');observed.set(row.observationId,row);}
  const findings=[];const add=(code,observationId,subjectId=null)=>findings.push({code,observationId,subjectId});
  for(const key of required)if(!observed.has(key))add('REQUIRED_OBSERVATION_MISSING',key);
  const mapped=new Set();
  for(const row of assignments){exact(row,['observationId','subjectId','scopeQuote']);id(row.observationId);id(row.subjectId);text(row.scopeQuote,{limit:200});check(row.scopeQuote.trim().length>=2,'OBSERVATION_QUOTE');
    const key=`${row.observationId}\u0000${row.subjectId}`;check(!seenAssignments.has(key),'OBSERVATION_ASSIGNMENT_DUPLICATE');seenAssignments.add(key);
    const obs=observed.get(row.observationId),scope=scopes.subjects.find(s=>s.subjectId===row.subjectId);
    if(!obs){add('ASSIGNMENT_OBSERVATION_MISSING',row.observationId,row.subjectId);continue;}
    if(!scope){add('ASSIGNMENT_SUBJECT_MISSING',row.observationId,row.subjectId);continue;}
    if(scope.layerId!==obs.layerId||scope.parentRole!==obs.parentRole){add('ASSIGNMENT_LAYER_MISMATCH',row.observationId,row.subjectId);continue;}
    if(!obs.description.includes(row.scopeQuote)||!scope.content.includes(row.scopeQuote)){add('ASSIGNMENT_QUOTE_MISSING',row.observationId,row.subjectId);continue;}
    mapped.add(row.observationId);
  }
  for(const key of observed.keys())if(!mapped.has(key))add('OBSERVATION_UNCOVERED',key);
  findings.sort((a,b)=>a.code.localeCompare(b.code)||a.observationId.localeCompare(b.observationId)||(a.subjectId??'').localeCompare(b.subjectId??''));
  return seal({format:'ai_scene_reference_observation_coverage_v1',referenceRawSha256,requirementsSha256:requirements.sha256,sourceScopesSha256:sourceScopes.sha256,
    inputSha256:digest({requiredObservationIds,observations,assignments}),status:findings.length?'fail':'pass',findings,
    observationCount:observations.length,requiredObservationCount:requiredObservationIds.length,assignmentCount:assignments.length,
    observationOrigin:'explicit-human-or-agent-data',automaticImageUnderstanding:false,semanticCorrectness:'not-assessed',
    artAcceptance:'not-assessed',generationCalls:0});
}

// Callers opting into a planning gate must replay the complete explicit input;
// accepting an isolated report digest would not detect changed observations.
export function assertReferenceObservationCoverage(options,report) {
  unseal(report);const actual=checkReferenceObservationCoverage(options);
  check(digest(report)===digest(actual),'OBSERVATION_COVERAGE_STALE');
  check(actual.status==='pass','OBSERVATION_COVERAGE_INCOMPLETE');
  return actual;
}
