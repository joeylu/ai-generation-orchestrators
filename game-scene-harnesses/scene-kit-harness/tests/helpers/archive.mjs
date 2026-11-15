import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { crc32 } from '../../src/png.mjs';
import { portablePath } from '../../src/files.mjs';

// Test-only ZIP32 stored reader. Real interoperability is separately checked
// with the platform archive reader; no untrusted ZIP import is exposed by Studio.
export function unpackStored(bytes, output) {
  let offset = 0; const entries = new Map();
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const path = bytes.subarray(offset + 30, offset + 30 + length).toString('utf8'); assert.ok(portablePath(path)); assert.ok(!entries.has(path));
    const start = offset + 30 + length + extra, data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), bytes.readUInt32LE(offset + 14)); entries.set(path, Buffer.from(data)); offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50); assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 6), offset); assert.equal(bytes.readUInt16LE(bytes.length - 12), entries.size);
  if (output) for (const [path, data] of entries) { const target = join(output, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data, { flag: 'wx' }); }
  return entries;
}
