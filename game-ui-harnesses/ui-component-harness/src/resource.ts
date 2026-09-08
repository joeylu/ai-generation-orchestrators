import { HarnessError } from './contract.ts';
export async function loadImage(source: string, signal: AbortSignal, path = '$.slots.visual.props.source'): Promise<HTMLImageElement> {
  const timeout = AbortSignal.timeout(10000);
  const bounded = AbortSignal.any([signal, timeout]);
  let url: string | undefined;
  try {
    const response = await fetch(source, { signal: bounded, headers: { Accept: 'image/*' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`预期 image/*，实际 ${blob.type || '无 Content-Type'}`);
    url = URL.createObjectURL(blob);
    const image = new Image(); image.src = url;
    let abort: () => void = () => {};
    try {
      await Promise.race([
        image.decode(),
        new Promise<never>((_, reject) => {
          abort = () => reject(bounded.reason);
          if (bounded.aborted) abort(); else bounded.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally { bounded.removeEventListener('abort', abort); }
    bounded.throwIfAborted();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片解码后尺寸为 0');
    return image;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new HarnessError('resource', [{ path, code: timeout.aborted ? 'RESOURCE_TIMEOUT' : 'RESOURCE_LOAD_FAILED', message: `${source}：${error instanceof Error ? error.message : String(error)}` }]);
  } finally { if (url) URL.revokeObjectURL(url); }
}
