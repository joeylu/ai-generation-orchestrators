import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { importLegacyLayeredZip, LegacyLayeredImportError } from '../scripts/legacy-layered-import.mjs';
import { legacyLayeredFixtureZip } from './helpers/legacy-layered-fixture.mjs';

const encoder = new TextEncoder();
const expectedPaths = [
  'file-roundtrip.json', 'layer-inputs.json',
  'layers/base_dropdown_still_baked_in.png', 'layers/cancel.png', 'layers/cancel_native.png',
  'layers/close.png', 'layers/close_native.png', 'layers/confirm.png', 'layers/confirm_native.png',
  'layers/music_toggle.png', 'layers/music_toggle_native.png', 'layers/quality_dropdown_native.png',
  'layers/sound_toggle.png', 'layers/sound_toggle_native.png', 'manifest.json',
  'native-assets-preview.png', 'native-assets.png', 'native-assets.psd', 'photoshop-checks.json', 'README.md',
  'settings-reconstruction-preview.png', 'settings-reconstruction.png', 'settings-reconstruction.psd',
].sort();
const native = ['cancel_native', 'confirm_native', 'close_native', 'music_toggle_native', 'sound_toggle_native', 'quality_dropdown_native'];
const settings = ['base_dropdown_still_baked_in', 'cancel', 'confirm', 'close', 'music_toggle', 'sound_toggle'];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const u16 = (value: number) => Uint8Array.of(value & 255, (value >>> 8) & 255);
const u32 = (value: number) => Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
const be32 = (value: number) => Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
function join(parts: readonly Uint8Array[]): Uint8Array { const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function crc32(bytes: Uint8Array): number { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let index = 0; index < 8; index += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(name: string, bytes: Uint8Array): Uint8Array { const label = encoder.encode(name); return join([be32(bytes.length), label, bytes, be32(crc32(join([label, bytes])))]); }
function png(): Uint8Array {
  const scanline = Uint8Array.of(0, 26, 84, 126, 255); let a = 1, b = 0;
  for (const byte of scanline) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  const zlib = join([Uint8Array.of(0x78, 1, 1, 5, 0, 0xfa, 0xff), scanline, be32(((b << 16) | a) >>> 0)]);
  return join([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', join([be32(1), be32(1), Uint8Array.of(8, 6, 0, 0, 0)])), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())]);
}
function zip(entries: ReadonlyArray<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const sorted = [...entries].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0); const locals: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const entry of sorted) {
    const name = encoder.encode(entry.name), compressed = new Uint8Array(deflateRawSync(entry.bytes)), crc = crc32(entry.bytes);
    const local = join([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(compressed.length), u32(entry.bytes.length), u16(name.length), u16(0), name, compressed]);
    locals.push(local); central.push(join([u32(0x02014b50), u16(0x0314), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(compressed.length), u32(entry.bytes.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0x81a40000), u32(offset), name])); offset += local.length;
  }
  const directory = join(central); return join([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(sorted.length), u16(sorted.length), u32(directory.length), u32(offset), u16(0)]);
}
function layer(name: string) { return { kind: 'pixel', name, png: `layers/${name}.png`, sha256: hash(image), rgba_sha256: 'a'.repeat(64), size: [1, 1], left: 0, top: 0, visible: true, opacity: 255, blend_mode: 'normal', alpha: { transparent_pixels: 0, soft_alpha_pixels: 0, opaque_pixels: 1, transparent_nonzero_rgb_pixels: 0 } }; }
const image = png();
function fixture(options: { tamperManifest?: boolean; traversal?: boolean } = {}) {
  const inputs = {
    kind: 'experimental_export_input_bundle_v1', status: 'inputs_prepared_not_exported', no_new_generation: true, fonts_and_editable_text: false, program_sha256: 'b'.repeat(64), environment: { python: '3.12.13', pillow: '12.3.0', numpy: '2.3.5' }, source_fingerprints: [{ path: 'work/references/one.png', sha256: 'c'.repeat(64) }],
    documents: [
      { id: 'native-assets', size: [1, 1], format: 'psd', order: 'bottom_to_top', tree: [{ kind: 'group', name: 'six_native_assets', children: native.map(layer) }], comparison_source: 'accepted_components_at_original_atlas_positions', preview: 'native-assets.png', preview_sha256: hash(image), preview_rgba_sha256: 'd'.repeat(64), matches_prior_pixels_exactly: true },
      { id: 'settings-reconstruction', size: [1, 1], format: 'psd', order: 'bottom_to_top', tree: [layer(settings[0]!), { kind: 'group', name: 'five_controls', children: settings.slice(1).map(layer) }], comparison_source: 'prior_five_control_reconstruction_dropdown_remains_in_base', preview: 'settings-reconstruction.png', preview_sha256: hash(image), preview_rgba_sha256: 'e'.repeat(64), matches_prior_pixels_exactly: true },
    ], validation_contract: { pixel_layer_roundtrip_max_error: 0, merged_preview_max_channel_error: 1, independent_opaque_preview_decoder: 'Pillow', photoshop_open_check: 'not_run' }, limitations: ['Coordinates remain historical approximations.'],
  };
  const entries = new Map<string, Uint8Array>();
  for (const path of expectedPaths) if (path !== 'manifest.json') entries.set(path, encoder.encode(path.endsWith('.png') ? '' : '{}'));
  entries.set('layer-inputs.json', encoder.encode(JSON.stringify(inputs)));
  for (const name of [...native, ...settings]) entries.set(`layers/${name}.png`, image);
  entries.set('native-assets.png', image); entries.set('native-assets-preview.png', image); entries.set('settings-reconstruction.png', image); entries.set('settings-reconstruction-preview.png', image);
  const manifest = { kind: 'experimental_ui_layered_export_delivery_v1', status: 'verified_pilot', format: 'psd', fonts_recovered: false, new_generation: false, photoshop_version: '23.4.1', files: expectedPaths.filter(path => path !== 'manifest.json').map(path => ({ file: path, bytes: entries.get(path)!.length, sha256: hash(entries.get(path)!) })) };
  if (options.tamperManifest) manifest.files[0]!.sha256 = '0'.repeat(64);
  entries.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
  const output = [...entries].map(([name, bytes]) => ({ name, bytes }));
  if (options.traversal) output[0] = { ...output[0]!, name: '../escape.txt' };
  return zip(output);
}

test('imports only the explicit compressed legacy pilot shape and preserves its legacy identity', () => {
  const imported = importLegacyLayeredZip(fixture());
  assert.equal(imported.legacy.kind, 'experimental_ui_layered_export_delivery_v1');
  assert.equal(imported.documents.length, 2);
  assert.deepEqual(imported.documents.map((document: any) => [document.id, document.layers.length]), [['native-assets', 6], ['settings-reconstruction', 6]]);
  assert.equal(imported.documents[1]!.layers[1]!.id, 'cancel');
  assert.equal(imported.resources.length, 14);
  assert.equal(imported.documents[1]!.preview.path, 'settings-reconstruction.png');
});

test('rejects changed manifest file hashes and archive path traversal', () => {
  assert.throws(() => importLegacyLayeredZip(fixture({ tamperManifest: true })), (error: unknown) => error instanceof LegacyLayeredImportError && error.code === 'LEGACY_MANIFEST_FILE');
  assert.throws(() => importLegacyLayeredZip(fixture({ traversal: true })), (error: unknown) => error instanceof LegacyLayeredImportError && error.code === 'LEGACY_ZIP_PATH_INVALID');
});

test('rejects duplicate names, symbolic-link metadata, and entries above the bounded inflate limit', () => {
  assert.throws(() => importLegacyLayeredZip(legacyLayeredFixtureZip({ duplicate: true })), (error: unknown) => error instanceof LegacyLayeredImportError && error.code === 'LEGACY_ZIP_DUPLICATE');
  assert.throws(() => importLegacyLayeredZip(legacyLayeredFixtureZip({ symlink: true })), (error: unknown) => error instanceof LegacyLayeredImportError && error.code === 'LEGACY_ZIP_FEATURE_UNSUPPORTED');
  assert.throws(() => importLegacyLayeredZip(legacyLayeredFixtureZip({ oversized: true })), (error: unknown) => error instanceof LegacyLayeredImportError && error.code === 'LEGACY_ZIP_FEATURE_UNSUPPORTED');
});
