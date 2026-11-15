import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, mkdirSync, readdirSync, unlinkSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { makeFreshDirectory, parseJson, readSelectedFile } from '../files.mjs';
import { check, exact, hash, id, isDigest, jsonBytes, seal, unseal } from './common.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
function writeNew(path, bytes) {
  let descriptor;
  try { descriptor = openSync(path, 'wx'); writeFileSync(descriptor, bytes); fsyncSync(descriptor); }
  catch { check(false, 'WORKFLOW_WRITE_FAILED', 'Fresh write failed; retain partial evidence and inspect before continuing'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}
function directory(path) {
  let stat;
  try { stat = lstatSync(path); } catch { check(false, 'WORKFLOW_UNAVAILABLE'); }
  check(stat.isDirectory() && !stat.isSymbolicLink(), 'WORKFLOW_PATH');
}
// The root ancestors and fixed immediate directories are checked once per
// locked transaction. Each leaf is still bounded, regular, non-linked and hashed.
function localFile(path, limit = 2097152) {
  try {
    const stat = lstatSync(path);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'WORKFLOW_PATH');
    const bytes = readFileSync(path); check(bytes.length <= limit, 'WORKFLOW_LIMIT'); return bytes;
  } catch (error) { if (error.errors) throw error; check(false, 'WORKFLOW_UNAVAILABLE'); }
}
export function initWorkflow(root, { projectId, purpose, compiler = 'scene-kit-generation-v1' }) {
  id(projectId); check(['external-exchange', 'synthetic-simulation'].includes(purpose), 'WORKFLOW_PURPOSE');
  check(['scene-kit-generation-v1', 'scene-kit-native-reference-v2'].includes(compiler), 'WORKFLOW_COMPILER');
  const target = makeFreshDirectory(root, sourceRoot);
  mkdirSync(join(target, 'events')); mkdirSync(join(target, 'blobs'));
  const metadata = seal({ format: 'ai_scene_workflow_v1', compiler, projectId, purpose });
  writeNew(join(target, 'workflow.json'), jsonBytes(metadata));
  return metadata;
}
export function transact(root, operation) {
  const target = resolve(root); directory(target);
  // Opening a verified regular marker also checks all ancestor components.
  readSelectedFile(join(target, 'workflow.json'));
  let descriptor;
  try { descriptor = openSync(join(target, '.lock'), 'wx'); writeFileSync(descriptor, randomBytes(16)); fsyncSync(descriptor); }
  catch { if (descriptor !== undefined) closeSync(descriptor); check(false, 'WORKFLOW_BUSY', 'Workspace is locked; never automatically clear a crash lock'); }
  try {
    const metadata = parseJson(readSelectedFile(join(target, 'workflow.json')));
    const body = unseal(metadata); exact(body, ['format', 'compiler', 'projectId', 'purpose']);
    id(body.projectId); check(body.format === 'ai_scene_workflow_v1' && ['scene-kit-generation-v1', 'scene-kit-native-reference-v2'].includes(body.compiler)
      && ['external-exchange', 'synthetic-simulation'].includes(body.purpose), 'WORKFLOW_METADATA');
    directory(join(target, 'events')); directory(join(target, 'blobs'));
    check(readdirSync(target).every(name => ['workflow.json', 'events', 'blobs', '.lock'].includes(name)), 'WORKFLOW_UNLISTED');
    const eventNames = readdirSync(join(target, 'events')).sort();
    check(eventNames.length <= 4096, 'WORKFLOW_LIMIT');
    let previousSha256 = metadata.sha256, journalBytes = 0, blobBytes = 0;
    const events = eventNames.map((name, index) => {
      check(name === `${String(index + 1).padStart(6, '0')}.json`, 'JOURNAL_SEQUENCE');
      const bytes = localFile(join(target, 'events', name)); journalBytes += bytes.length;
      check(journalBytes <= 33554432, 'WORKFLOW_LIMIT');
      const event = parseJson(bytes), entry = unseal(event);
      exact(entry, ['format', 'sequence', 'previousSha256', 'record']);
      check(entry.format === 'ai_scene_workflow_event_v1' && entry.sequence === index + 1 && entry.previousSha256 === previousSha256, 'JOURNAL_INTEGRITY');
      unseal(entry.record); previousSha256 = event.sha256; return event;
    });
    const blobs = new Map();
    for (const name of readdirSync(join(target, 'blobs'))) {
      check(/^[a-f0-9]{64}\.bin$/.test(name), 'BLOB_PATH');
      const bytes = localFile(join(target, 'blobs', name), 16777216);
      blobBytes += bytes.length; check(blobBytes <= 268435456, 'WORKFLOW_LIMIT');
      check(hash(bytes) === name.slice(0, -4), 'BLOB_INTEGRITY'); blobs.set(name.slice(0, -4), bytes);
    }
    const store = {
      metadata, events,
      readBlob(sha256) { check(isDigest(sha256) && blobs.has(sha256), 'BLOB_MISSING'); return Buffer.from(blobs.get(sha256)); },
      storeBlob(bytes) {
        check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'IMAGE_BYTES');
        const copy = Buffer.from(bytes), sha256 = hash(copy);
        if (!blobs.has(sha256)) {
          check(blobBytes + bytes.length <= 268435456, 'WORKFLOW_LIMIT');
          writeNew(join(target, 'blobs', `${sha256}.bin`), copy); blobs.set(sha256, copy); blobBytes += copy.length;
        }
        return { sha256, byteLength: copy.length };
      },
      append(record) {
        check(events.length < 4096, 'WORKFLOW_LIMIT'); unseal(record);
        const event = seal({ format: 'ai_scene_workflow_event_v1', sequence: events.length + 1, previousSha256, record });
        const bytes = jsonBytes(event); check(bytes.length <= 2097152 && journalBytes + bytes.length <= 33554432, 'WORKFLOW_LIMIT');
        writeNew(join(target, 'events', `${String(event.sequence).padStart(6, '0')}.json`), bytes);
        events.push(event); previousSha256 = event.sha256; journalBytes += bytes.length;
      },
    };
    return operation(store);
  } finally {
    closeSync(descriptor); unlinkSync(join(target, '.lock'));
  }
}
