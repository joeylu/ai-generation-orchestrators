import {check,exact,id,isDigest,text} from './common.mjs';

// Explicit observations, not feature detection. Deltas are fractions of the
// full asset width/height, not coordinates in the reference or author map.
export function validateBandFeatureRelations(value) {
  exact(value,['format','referenceRawSha256','features','relations']);
  check(value.format==='ai_scene_band_feature_relations_v1'&&isDigest(value.referenceRawSha256),'BAND_RELATIONS_BINDING');
  check(Array.isArray(value.features)&&value.features.length>=2&&value.features.length<=12,'BAND_RELATIONS_FEATURES');
  const ids=new Map();
  for(const f of value.features){exact(f,['featureId','description']);id(f.featureId);text(f.description,{limit:200});check(!ids.has(f.featureId),'BAND_RELATIONS_FEATURES');ids.set(f.featureId,ids.size);}
  check(Array.isArray(value.relations)&&value.relations.length>=1&&value.relations.length<=24,'BAND_RELATIONS_COUNT');
  const n=ids.size, matrices={x:Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:1)),y:Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:1))}, seen=new Set();
  for(const r of value.relations){exact(r,['from','to','axis','min','max']);check(ids.has(r.from)&&ids.has(r.to)&&r.from!==r.to&&['x','y'].includes(r.axis),'BAND_RELATIONS_FEATURES');
    check(Number.isFinite(r.min)&&Number.isFinite(r.max)&&r.min>=-1&&r.max<=1&&r.min<=r.max,'BAND_RELATIONS_RANGE');
    const key=`${r.axis}:${r.from}:${r.to}`;check(!seen.has(key),'BAND_RELATIONS_DUPLICATE');seen.add(key);
    const a=ids.get(r.from),b=ids.get(r.to),m=matrices[r.axis];m[a][b]=Math.min(m[a][b],r.max);m[b][a]=Math.min(m[b][a],-r.min);
  }
  for(const m of Object.values(matrices)){for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++)m[i][j]=Math.min(m[i][j],m[i][k]+m[k][j]);
    for(let i=0;i<n;i++)check(m[i][i]>=-1e-9,'BAND_RELATIONS_CONTRADICTION');}
  return value;
}
export function bandFeatureRelationsPrompt(value) {
  validateBandFeatureRelations(value);
  const names=new Map(value.features.map(f=>[f.featureId,f.description]));
  return ['REFERENCE-OBSERVED SAME-LAYER FEATURE RELATIONS: use only the following explicitly named features and approximate signed separations within this asset. They are observed targets, not exact contours, counts, coordinates, or permission to copy the complete reference composition. Positive x points right; positive y points down. Fractions are of the entire output band width or height respectively.',
    ...value.relations.map(r=>`From ${names.get(r.from)} to ${names.get(r.to)}: ${r.axis} separation ${r.min} to ${r.max} of asset ${r.axis==='x'?'width':'height'}.`),
    'Only the declared band owns these features. Continue the same layer to its finite cuts, and keep neighboring playable terrain, foreground and sky separate. This explicit observation does not guarantee generation compliance or visual acceptance.'].join('\n');
}
