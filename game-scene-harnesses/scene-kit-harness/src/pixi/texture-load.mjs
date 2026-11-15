// Bound source requests and reuse texture identity across visual variants.
// No retry: a failed load returns the original error after in-flight work ends.
export async function loadModuleTextures(modules, load, concurrency = 8) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid texture concurrency');
  const groups = new Map();
  for (const module of modules) {
    const key = module.source.sha256;
    if (!groups.has(key)) groups.set(key, { module, ids: [], linear: false });
    const group = groups.get(key); group.ids.push(module.assetId); group.linear ||= Boolean(module.renderStyle);
  }
  const pending = [...groups.values()], result = new Map(); let next = 0, failure, failed = false;
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (!failed && next < pending.length) {
      const group = pending[next++];
      try {
        const texture = await load(group.module); texture.source.scaleMode = group.linear ? 'linear' : 'nearest';
        for (const id of group.ids) result.set(id, texture);
      } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure; return result;
}
