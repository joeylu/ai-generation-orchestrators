// The verified compiled document owns the fields; the host owns URL resolution
// and texture lifetime. The same sampler setup is used by Studio and consumers.
export async function loadTerrainMaterial(fields, loadTexture) {
  if (!fields) return null;
  const entries = await Promise.all(['body', 'cap'].map(async kind => {
    if (!fields[kind]?.source) throw new Error('Terrain material source is missing');
    const texture = await loadTexture(fields[kind], kind);
    if (!texture?.source?.style) throw new Error('Terrain material texture is unavailable');
    texture.source.style.addressModeU = 'repeat';
    texture.source.style.addressModeV = kind === 'body' ? 'repeat' : 'clamp-to-edge';
    texture.source.scaleMode = 'linear';
    return [kind, texture];
  }));
  const result = Object.fromEntries(entries);
  if (fields.edges) {
    const edgeEntries = await Promise.all(['left', 'right'].flatMap(side => ['wall', 'corner'].map(async part => {
      const key = `${side}.${part}`, item = fields.edges[side]?.[part];
      if (!item?.source) throw new Error('Terrain side material source is missing');
      const texture = await loadTexture(item, key);
      if (!texture?.source?.style) throw new Error('Terrain side texture is unavailable');
      texture.source.style.addressModeU = 'clamp-to-edge';
      texture.source.style.addressModeV = 'clamp-to-edge';
      texture.source.scaleMode = 'linear';
      return [key, texture];
    })));
    result.edges = Object.fromEntries(edgeEntries);
  }
  if(fields.bottomEdges){
    result.edges??={};
    for(const part of ['edge','leftCorner','rightCorner']){
      const key=`bottom.${part}`,item=fields.bottomEdges[part];
      if(!item?.source)throw new Error('Terrain bottom material source is missing');
      const texture=await loadTexture(item,key);
      if(!texture?.source?.style)throw new Error('Terrain bottom texture is unavailable');
      texture.source.style.addressModeU='clamp-to-edge';texture.source.style.addressModeV='clamp-to-edge';
      texture.source.scaleMode='linear';result.edges[key]=texture;
    }
  }
  return result;
}
