export const VERTEX_COVERAGE_PROFILE='linear-vertex-coverage-v1';

// An optional fixed renderer contract, not a shader/code input. Old meshes
// without either field keep their historical uniform-opacity path.
export function validateMeshCoverage(data){
  const present=Object.hasOwn(data,'vertexCoverage')||Object.hasOwn(data,'coverageInterpolation');
  if(!present)return false;
  if(data.coverageInterpolation!==VERTEX_COVERAGE_PROFILE||!Array.isArray(data.vertexCoverage)
    ||data.vertexCoverage.length!==data.positions.length/2||data.vertexCoverage.length>4096
    ||data.vertexCoverage.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid vertex coverage');
  return true;
}
