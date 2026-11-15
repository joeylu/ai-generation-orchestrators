import {canonicalJson} from './document.mjs';

const partitionPieceFields = new Set(['positions', 'uvs', 'indices', 'coverageOpacity', 'nativeCoverageInterval', 'adaptiveBottomFade', 'edgeId']);

// Call only for one original native placement's disjoint coverage-grid pieces.
// It is not a general overlap sorter: placements retain their original order.
// Equal-state fragments share an indexed draw without changing any vertex,
// UV, source sample, coverage opacity or triangle. Their partition rectangles
// have disjoint interiors, so interleaved unequal-state fragments cannot alter
// one another's source-over result.
export function mergeDisjointCoverageMeshes(meshes){
  const output=[],states=new Map();
  for(const original of meshes){
    if(!original.indices.length)continue;
    const data=original;
    const key=canonicalJson({materialKey:data.materialKey,source:data.source,coverageOpacity:data.coverageOpacity??1}),
      fields=['nativeCoverageInterval','adaptiveBottomFade','edgeId','nativeSourceOriginWorld'],
      part={firstVertex:0,vertexCount:data.positions.length/2,firstIndex:0,indexCount:data.indices.length,
        ...Object.fromEntries(fields.filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]))};
    let target=states.get(key);
    if(!target){
      target={...data,positions:[...data.positions],uvs:[...data.uvs],indices:[...data.indices],coverageGeometryParts:[part]};
      states.set(key,target);output.push(target);continue;
    }
    const vertex=target.positions.length/2,index=target.indices.length;
    for(const value of data.positions)target.positions.push(value);
    for(const value of data.uvs)target.uvs.push(value);
    for(const value of data.indices)target.indices.push(value+vertex);
    target.coverageGeometryParts.push({...part,firstVertex:vertex,firstIndex:index});
    // Per-fragment intervals and fades stay attached to the exact index range;
    // a merged mesh must not claim its first fragment's interval for the rest.
    delete target.nativeCoverageInterval;delete target.adaptiveBottomFade;
    if(canonicalJson(target.nativeSourceOriginWorld??null)!==canonicalJson(data.nativeSourceOriginWorld??null))delete target.nativeSourceOriginWorld;
  }
  return output;
}

export function mergeNativeCoveragePartitions(meshes,eligible){
  const output=[];let partition=[],last;
  const flush=()=>{if(partition.length)output.push(...mergeDisjointCoverageMeshes(partition));partition=[];last=undefined;};
  for(const mesh of meshes){
    if(!eligible(mesh)){flush();output.push(mesh);continue;}
    // The v2 horizontal source uses disjoint half-open repeat windows. Adjacent
    // windows of this same chain are one coverage partition too; their original
    // phase remains in each vertex UV and each fragment's recorded origin.
    const windowed=mesh.bottomPart==='edge'&&mesh.nativeRepeatWindow?.interval==='half-open-source-pixels';
    const metadata=Object.create(null);
    for (const key of Object.keys(mesh)) {
      if (!partitionPieceFields.has(key) && !(windowed && key==='nativeSourceOriginWorld')) metadata[key]=mesh[key];
    }
    const key=canonicalJson(metadata);
    if(partition.length&&key!==last)flush();last=key;partition.push(mesh);
  }
  flush();return output;
}
