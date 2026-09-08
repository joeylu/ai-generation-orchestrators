import { compileTree, validateTreeIntent, type ImageFactsMap } from './tree-compiler.ts';
import { walkNodes, type UiDocument } from './tree-contract.ts';

export type VisionSource = { path: string; sha256: string; width: number; height: number; mime: string; base64: string };
export type VisionResult = { status: 'Ready'; summary: string; document: UiDocument }
  | { status: 'Unresolved' | 'Custom-required'; summary: string };

/** Model output is untrusted: bind it to this image, then compile without defaults. */
export function compileVisionResult(value: unknown, source: Pick<VisionSource, 'path' | 'sha256' | 'width' | 'height'>): VisionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VISION_INVALID_RESPONSE');
  const data = value as Record<string, unknown>;
  const keys = data.status === 'Ready' ? ['version', 'sourceSha256', 'status', 'summary', 'intent', 'policy'] : ['version', 'sourceSha256', 'status', 'summary'];
  if (keys.some(key => !Object.hasOwn(data, key)) || Object.keys(data).some(key => !keys.includes(key))
    || data.version !== '0.1' || data.sourceSha256 !== source.sha256
    || typeof data.summary !== 'string' || !data.summary.trim() || data.summary.length > 2000) throw new Error('VISION_INVALID_RESPONSE');
  if (data.status === 'Unresolved' || data.status === 'Custom-required') return { status: data.status, summary: data.summary };
  if (data.status !== 'Ready') throw new Error('VISION_INVALID_RESPONSE');
  const intent = validateTreeIntent(data.intent);
  const facts: ImageFactsMap = {};
  const visit = (node: typeof intent.root) => {
    if (node.componentType === 'Image') {
      if (node.props.source !== source.path) throw new Error('VISION_UNAVAILABLE_RESOURCE');
      facts[source.path] = { width: source.width, height: source.height };
    }
    if (node.componentType === 'Text' && node.props.fontSource) throw new Error('VISION_UNAVAILABLE_RESOURCE');
    if ('children' in node) node.children.forEach(visit);
  };
  visit(intent.root);
  const document = compileTree(intent, facts, data.policy);
  if (document.canvas.width > 4096 || document.canvas.height > 4096) throw new Error('VISION_CANVAS_LIMIT');
  if (!walkNodes(document).length) throw new Error('VISION_EMPTY_DOCUMENT');
  return { status: 'Ready', summary: data.summary, document };
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 503) throw new Error('VISION_NOT_CONFIGURED');
  if (!response.ok) throw new Error('VISION_REQUEST_FAILED');
  const reader = response.body?.getReader(); if (!reader) throw new Error('VISION_INVALID_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 2 * 1024 * 1024) throw new Error('VISION_RESPONSE_LIMIT');
      chunks.push(part.value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Preserve original read error. */ }
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (cause) { throw new Error('VISION_INVALID_RESPONSE', { cause }); }
}
function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export async function recognizeReference(source: VisionSource, signal: AbortSignal, onPending: () => void = () => {}): Promise<VisionResult> {
  const activeSignal = AbortSignal.any([signal, AbortSignal.timeout(95000)]);
  let response = await fetch('/api/ui-vision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '0.1', source }), signal: activeSignal,
  });
  let analysisId: string | undefined;
  while (true) {
    const value = await readResponse(response); activeSignal.throwIfAborted();
    if (response.status !== 202) {
      try { return compileVisionResult(value, source); }
      catch (cause) { throw new Error('VISION_INVALID_RESPONSE', { cause }); }
    }
    const receipt = value as Record<string, unknown>;
    const keys = ['version', 'sourceSha256', 'status', 'analysisId', 'pollAfterSeconds'];
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || keys.some(key => !Object.hasOwn(receipt, key)) || Object.keys(receipt).some(key => !keys.includes(key))
      || receipt.version !== '0.1' || receipt.status !== 'Pending' || receipt.sourceSha256 !== source.sha256
      || typeof receipt.analysisId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.analysisId)
      || (analysisId !== undefined && analysisId !== receipt.analysisId)
      || typeof receipt.pollAfterSeconds !== 'number' || !Number.isInteger(receipt.pollAfterSeconds)
      || receipt.pollAfterSeconds < 1 || receipt.pollAfterSeconds > 3600) throw new Error('VISION_INVALID_RECEIPT');
    analysisId = receipt.analysisId; onPending();
    await waitForPoll(receipt.pollAfterSeconds * 1000, activeSignal);
    response = await fetch('/api/ui-vision?analysisId=' + encodeURIComponent(analysisId), { signal: activeSignal });
  }
}

export function encodeReference(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}
