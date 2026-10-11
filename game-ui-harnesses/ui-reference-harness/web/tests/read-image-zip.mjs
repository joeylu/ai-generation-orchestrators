import assert from "node:assert/strict";

// Read STORE local entries independently of the archive writer. Verify central
// directory offsets, UTF-8 flags and size boundaries so renamed headers agree.
export function readImageZip(bytes) {
  const files = new Map();
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let central = bytes.readUInt32LE(end + 16);
  assert.equal(central + bytes.readUInt32LE(end + 12), end);
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(central), 0x02014b50);
    assert.equal(bytes.readUInt16LE(central + 8), 0x800);
    assert.equal(bytes.readUInt16LE(central + 10), 0);
    const nameLength = bytes.readUInt16LE(central + 28);
    const name = bytes.toString(
      "utf8",
      central + 46,
      central + 46 + nameLength,
    );
    const offset = bytes.readUInt32LE(central + 42);
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
    assert.equal(bytes.readUInt16LE(offset + 6), 0x800);
    const localNameLength = bytes.readUInt16LE(offset + 26);
    assert.equal(
      bytes.toString("utf8", offset + 30, offset + 30 + localNameLength),
      name,
    );
    const size = bytes.readUInt32LE(central + 24);
    assert.equal(size, bytes.readUInt32LE(offset + 22));
    assert.equal(
      bytes.readUInt32LE(offset + 14),
      bytes.readUInt32LE(central + 16),
    );
    assert.ok(!files.has(name));
    files.set(
      name,
      bytes.subarray(
        offset + 30 + localNameLength,
        offset + 30 + localNameLength + size,
      ),
    );
    central += 46 + nameLength;
  }
  assert.equal(central, end);
  return files;
}
