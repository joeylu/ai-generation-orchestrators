import { lstat, mkdir, open, readdir, unlink, rename } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, readSafe } from '../skins/package.mjs';
import { validateSizeEdit } from '../panel/size-edit.mjs';

const artifactPattern = /^[a-z][a-z0-9-]{0,48}$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const sourceTypes = new Set(['model-response', 'offline-fixtures', 'frozen-preview']);
const maxDocumentBytes = 4 * 1024 * 1024;
const maxRevisionBytes = 5 * 1024 * 1024;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function safeKey(value) {
  return typeof value === 'string' && keyPattern.test(value) && !value.includes('..') &&
    !/[. ]$/.test(value) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);
}
function identity({ artifactId, variantKey } = {}) {
  if (typeof artifactId !== 'string' || !artifactPattern.test(artifactId) || !safeKey(variantKey))
    fail('PANEL_REVISION_ID_INVALID');
  return `work/studio/panel-revisions/${artifactId}/${variantKey}`;
}
function plainJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) plainJson(item); return; }
  if (typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail('PANEL_REVISION_JSON_INVALID');
  for (const item of Object.values(value)) plainJson(item);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function documentHash(value) { return hash(Buffer.from(JSON.stringify(stable(value)))); }
function equal(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function boundedDocument(value) {
  plainJson(value);
  if (Buffer.byteLength(JSON.stringify(value)) > maxDocumentBytes) fail('PANEL_REVISION_SIZE_LIMIT');
  return value;
}
function view(record, document) {
  return { revisionId: record?.revisionId ?? null, docSha256: record?.docSha256 ?? documentHash(document), document: structuredClone(document) };
}

// Check every ancestor, including the configured root. Revisions never follow a
// junction into a delivery, another project, or any location outside local work.
async function noLinks(path) {
  const absolute = resolve(path), base = parse(absolute).root;
  let current = base;
  for (const part of absolute.slice(base.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail('PANEL_REVISION_PATH_INVALID'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function ensureDirectory(root, relative) {
  await noLinks(root);
  let current = root;
  for (const part of relative.split('/')) {
    current = join(current, part);
    try { await mkdir(current); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('PANEL_REVISION_PATH_INVALID');
  }
}

// Local authoring revisions are independent of the immutable generated preview,
// plan, receipt and manifest. resolveSource must return a verified frozen source.
export function createPanelRevisionStore(root, resolveSource) {
  if (typeof resolveSource !== 'function') fail('PANEL_REVISION_RESOLVER_INVALID');
  root = resolve(root);

  async function sourceFor(input) {
    identity(input);
    const source = await resolveSource(input.artifactId);
    if (source?.kind !== 'ui_panel_edit_source' || source.version !== '1.0' || source.artifactId !== input.artifactId ||
      !digestPattern.test(source.previewSha256 ?? '') || !digestPattern.test(source.pack?.manifestSha256 ?? '') ||
      !sourceTypes.has(source.source) || !Array.isArray(source.variants)) fail('PANEL_REVISION_SOURCE_INVALID');
    const variant = source.variants.find(item => item.key === input.variantKey);
    if (!variant) fail('PANEL_REVISION_VARIANT_UNAVAILABLE');
    const document = validateSizeEdit(variant.document, boundedDocument(variant.document), source.ctx);
    return { source, variant, document };
  }

  function recordMatches(record, filename, input, base) {
    const { source, variant, document } = base;
    const keys = ['kind', 'version', 'revisionId', 'sequence', 'parentRevision', 'createdAt', 'artifactId', 'variantKey',
      'previewSha256', 'skinSha256', 'source', 'sourceDocSha256', 'docSha256', 'authoring', 'modelCalls', 'planSha256'];
    if (!record || Object.keys(record).some(key => !keys.includes(key)) || record.kind !== 'ui_panel_size_revision' || record.version !== '1.0' ||
      record.revisionId + '.json' !== filename || !uuidPattern.test(record.revisionId) || !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
      !(record.parentRevision === null || uuidPattern.test(record.parentRevision ?? '')) ||
      typeof record.createdAt !== 'string' || new Date(record.createdAt).toISOString() !== record.createdAt ||
      record.artifactId !== input.artifactId || record.variantKey !== input.variantKey || record.previewSha256 !== source.previewSha256 ||
      record.skinSha256 !== source.pack.manifestSha256 || record.source !== source.source || record.modelCalls !== 0 ||
      record.sourceDocSha256 !== documentHash(document) || !digestPattern.test(record.docSha256 ?? '') ||
      !record.authoring || Object.keys(record.authoring).some(key => !['document', 'behavior'].includes(key)) ||
      Object.hasOwn(record.authoring, 'behavior') !== Object.hasOwn(variant, 'behavior') ||
      !equal(record.authoring.behavior, variant.behavior)) return false;
    if (Object.hasOwn(record, 'planSha256') && (!digestPattern.test(record.planSha256 ?? '') || record.planSha256 !== source.planSha256)) return false;
    const checked = validateSizeEdit(variant.document, boundedDocument(record.authoring.document), source.ctx);
    return equal(checked, record.authoring.document) && documentHash(checked) === record.docSha256;
  }

  async function latest(input, base) {
    const directory = identity(input);
    await noLinks(join(root, directory));
    let entries;
    try { entries = await readdir(join(root, directory), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const records = new Map();
    for (const entry of entries) {
      if (!uuidPattern.test(entry.name.replace(/\.json$/, '')) || !entry.name.endsWith('.json')) continue;
      if (entry.isSymbolicLink() || !entry.isFile()) fail('PANEL_REVISION_PATH_INVALID');
      // An interrupted exclusive write is never published as a valid revision.
      // Older complete revisions remain usable after reopening the Studio.
      let bytes;
      try { bytes = await readSafe(root, directory + '/' + entry.name, maxRevisionBytes); }
      catch (error) { if (error.code === 'skin.file') continue; throw error; }
      try {
        const record = JSON.parse(bytes);
        if (recordMatches(record, entry.name, input, base)) records.set(record.revisionId, record);
      } catch {
        // Syntax, hash, schema and size-edit errors invalidate only this copy.
        // Filesystem errors above remain fatal, so unreadable history can never
        // be mistaken for an empty history when saving the next revision.
      }
    }
    const valid = new Map();
    const connected = record => {
      if (valid.has(record.revisionId)) return valid.get(record.revisionId);
      // A decreasing sequence makes cycles impossible, including malformed files.
      const parent = records.get(record.parentRevision);
      const result = record.sequence === 1 ? record.parentRevision === null :
        !!parent && parent.sequence === record.sequence - 1 && connected(parent);
      valid.set(record.revisionId, result);
      return result;
    };
    const ordered = [...records.values()].filter(connected).sort((a, b) => b.sequence - a.sequence);
    const children = new Map();
    for (const record of ordered) {
      if (children.has(record.parentRevision)) fail('PANEL_REVISION_BRANCH_CONFLICT');
      children.set(record.parentRevision, record.revisionId);
    }
    return ordered[0] ?? null;
  }

  return {
    async load(input) {
      const base = await sourceFor(input), record = await latest(input, base);
      return view(record, record?.authoring.document ?? base.document);
    },
    async save(input) {
      const directory = identity(input);
      if (!(input.expectedRevision === null || uuidPattern.test(input.expectedRevision ?? '')) || !digestPattern.test(input.sourceSha256 ?? ''))
        fail('PANEL_REVISION_EXPECTED_INVALID');
      boundedDocument(input.document);
      await ensureDirectory(root, directory);
      const lockPath = join(root, directory, '.save.lock');
      let lock;
      try { lock = await open(lockPath, 'wx'); }
      catch (error) { if (error.code === 'EEXIST') fail('PANEL_REVISION_BUSY'); throw error; }
      try {
        const base = await sourceFor(input);
        if (input.sourceSha256 !== base.source.previewSha256) fail('PANEL_REVISION_SOURCE_CHANGED');
        const previous = await latest(input, base);
        if (input.expectedRevision !== (previous?.revisionId ?? null)) fail('PANEL_REVISION_STALE');
        const document = validateSizeEdit(base.variant.document, input.document, base.source.ctx);
        const record = {
          kind: 'ui_panel_size_revision', version: '1.0', revisionId: randomUUID(), sequence: (previous?.sequence ?? 0) + 1,
          parentRevision: previous?.revisionId ?? null, createdAt: new Date().toISOString(),
          artifactId: input.artifactId, variantKey: input.variantKey, previewSha256: base.source.previewSha256,
          skinSha256: base.source.pack.manifestSha256, source: base.source.source, sourceDocSha256: documentHash(base.document),
          docSha256: documentHash(document), authoring: { document, ...(Object.hasOwn(base.variant, 'behavior') ? { behavior: structuredClone(base.variant.behavior) } : {}) },
          modelCalls: 0,
          ...(digestPattern.test(base.source.planSha256 ?? '') ? { planSha256: base.source.planSha256 } : {}),
        };
        const bytes = Buffer.from(JSON.stringify(record, null, 2) + '\n');
        if (bytes.length > maxRevisionBytes) fail('PANEL_REVISION_SIZE_LIMIT');
        const temporary = join(root, directory, '.pending-' + record.revisionId + '.json');
        const published = join(root, directory, record.revisionId + '.json');
        const file = await open(temporary, 'wx');
        try {
          try { await file.writeFile(bytes); await file.sync(); }
          finally { await file.close(); }
          // The directory lock excludes other Studio publishers. A UUID names
          // exactly one immutable revision; never replace a pre-existing file.
          try { await lstat(published); fail('PANEL_REVISION_EXISTS'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          await rename(temporary, published);
        } finally {
          try { await unlink(temporary); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        return view(record, document);
      } finally { try { await lock.close(); } finally { await unlink(lockPath); } }
    },
  };
}
