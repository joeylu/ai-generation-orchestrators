/** Small deterministic ZIP writer (STORE). No compression service or filesystem API. */
const MAX_BYTES = 64 * 1024 * 1024;
const fail = code => { throw new Error(code); };
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ ((byte & 1) ? 0xedb88320 : 0);
  return byte >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export function createStoredZip(contents) {
  if (!(contents instanceof Map) || !contents.size || contents.size > 2048) fail('ZIP_FILE_COUNT');
  const names = new Set(); let localBytes = 0, centralBytes = 0;
  const entries = [...contents].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => {
    if (typeof path !== 'string' || path.length > 240 || !/^[A-Za-z0-9._/-]+$(?![\s\S])/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))
      || names.has(path.toLowerCase())) fail('ZIP_FILE_PATH');
    if (!(bytes instanceof Uint8Array)) fail('ZIP_FILE_BYTES');
    names.add(path.toLowerCase());
    const name = new TextEncoder().encode(path), offset = localBytes;
    localBytes += 30 + name.length + bytes.length; centralBytes += 46 + name.length;
    if (localBytes + centralBytes + 22 > MAX_BYTES) fail('ZIP_SIZE_LIMIT');
    return { name, bytes, offset, crc: crc32(bytes) };
  });
  for (const path of names) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++)
      if (names.has(parts.slice(0, index).join('/'))) fail('ZIP_FILE_PATH');
  }
  const zip = new Uint8Array(localBytes + centralBytes + 22), view = new DataView(zip.buffer);
  let local = 0, central = localBytes;
  for (const { name, bytes, offset, crc } of entries) {
    view.setUint32(local, 0x04034b50, true); view.setUint16(local + 4, 20, true);
    view.setUint16(local + 12, 0x21, true); // 1980-01-01, no host timestamps.
    view.setUint32(local + 14, crc, true); view.setUint32(local + 18, bytes.length, true);
    view.setUint32(local + 22, bytes.length, true); view.setUint16(local + 26, name.length, true);
    zip.set(name, local + 30); zip.set(bytes, local + 30 + name.length);
    view.setUint32(central, 0x02014b50, true); view.setUint16(central + 4, 20, true);
    view.setUint16(central + 6, 20, true); view.setUint16(central + 14, 0x21, true);
    view.setUint32(central + 16, crc, true); view.setUint32(central + 20, bytes.length, true);
    view.setUint32(central + 24, bytes.length, true); view.setUint16(central + 28, name.length, true);
    view.setUint32(central + 42, offset, true); zip.set(name, central + 46);
    local += 30 + name.length + bytes.length; central += 46 + name.length;
  }
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, entries.length, true); view.setUint16(central + 10, entries.length, true);
  view.setUint32(central + 12, centralBytes, true); view.setUint32(central + 16, localBytes, true);
  return zip;
}
