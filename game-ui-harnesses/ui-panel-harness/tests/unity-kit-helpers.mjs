import assert from 'node:assert/strict';

/** Independent acceptance reader, not imported by the production ZIP writer. */
export function readStoredZip(input) {
  const bytes = Buffer.from(input), end = bytes.length - 22;
  assert(end >= 0); assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 4), 0); assert.equal(bytes.readUInt16LE(end + 6), 0);
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(count, bytes.readUInt16LE(end + 8));
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16);
  assert.equal(centralOffset + centralSize, end);
  const files = new Map(); let offset = centralOffset;
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt16LE(offset + 8), 0); assert.equal(bytes.readUInt16LE(offset + 10), 0);
    const crc = bytes.readUInt32LE(offset + 16), size = bytes.readUInt32LE(offset + 24);
    assert.equal(size, bytes.readUInt32LE(offset + 20));
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength), local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt32LE(local + 14), crc); assert.equal(bytes.readUInt32LE(local + 22), size);
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    assert.equal(bytes.toString('utf8', local + 30, local + 30 + localName), name);
    const start = local + 30 + localName + localExtra;
    assert(start + size <= centralOffset);
    const content = bytes.subarray(start, start + size);
    // Bit-by-bit standard CRC-32 check deliberately uses no production lookup table.
    let actual = -1;
    for (const value of content) {
      actual ^= value;
      for (let bit = 0; bit < 8; bit++) actual = (actual >>> 1) ^ ((actual & 1) ? 0xedb88320 : 0);
    }
    assert.equal((actual ^ -1) >>> 0, crc);
    assert(!files.has(name)); files.set(name, content);
    offset += 46 + nameLength + extra + comment;
  }
  assert.equal(offset, end);
  return files;
}
