/** Bounded RGBA8 PNG alpha measurement. Caller authenticates PNG chunks first. */
export async function pngVisibleBounds(bytes: Uint8Array, width: number, height: number): Promise<number[]> {
  const fail = (): never => { throw new Error('ASSETS_PNG_DECODE_INVALID'); };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) fail();
    const size = view.getUint32(offset), end = offset + size + 12;
    if (end > bytes.length) fail();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'IDAT') chunks.push(bytes.slice(offset + 8, end - 4));
    offset = end;
  }
  const stride = width * 4, expected = height * (stride + 1);
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > 268_500_992) fail();
  const compressed = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let cursor = 0; for (const chunk of chunks) { compressed.set(chunk, cursor); cursor += chunk.length; }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader(), raw = new Uint8Array(expected); cursor = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (cursor + value.length > expected) { await reader.cancel(); fail(); }
      raw.set(value, cursor); cursor += value.length;
    }
  } catch { fail(); } finally { reader.releaseLock(); }
  if (cursor !== expected) fail();
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const prior = new Uint8Array(stride), row = new Uint8Array(stride);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = raw[offset]; if (filter > 4) fail();
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? row[i - 4] : 0, b = prior[i], c = i >= 4 ? prior[i - 4] : 0;
      row[i] = raw[offset + 1 + i] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c));
    }
    for (let x = 0; x < width; x++) if (row[x * 4 + 3] > 0) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    prior.set(row);
  }
  if (maxX < 0) throw new Error('ASSETS_EMPTY_ALPHA');
  return [minX, minY, maxX - minX + 1, maxY - minY + 1];
}
