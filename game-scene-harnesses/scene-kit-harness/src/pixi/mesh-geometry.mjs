// Compiled terrain meshes use indexed triangles. A zero-index mesh has no
// drawable pixels; do not submit it to Pixi's batcher as a zero-sized draw.
// Invalid nonempty geometry is an error, never repaired or padded here.
export function hasDrawableTriangles(data) {
  const array=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof value.length==='number';
  if(!data||!array(data.positions)||!array(data.uvs)||!array(data.indices)
    ||data.positions.length%2||data.positions.length!==data.uvs.length||data.indices.length%3) {
    throw new Error('TERRAIN_MESH_GEOMETRY: indexed triangle arrays must have matching position and UV pairs');
  }
  for(const values of [data.positions,data.uvs])for(const value of values) {
    if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value))) {
      throw new Error('TERRAIN_MESH_GEOMETRY: attributes must remain finite in GPU float buffers');
    }
  }
  const vertices=data.positions.length/2;
  for(const index of data.indices)if(!Number.isSafeInteger(index)||index<0||index>=vertices) {
    throw new Error('TERRAIN_MESH_GEOMETRY: triangle indices must address existing attribute pairs');
  }
  return data.indices.length>0;
}
