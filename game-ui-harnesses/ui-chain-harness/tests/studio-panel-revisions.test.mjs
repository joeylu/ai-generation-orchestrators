import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { editorData, presetDocument } from '../src/panel/data.mjs';
import { sizeEditDocument, textEditDocument } from '../src/panel/size-edit.mjs';
import { validateDocument } from '../src/panel/document.mjs';
import { createPanelRevisionStore } from '../src/studio/panel-revisions.mjs';

const ctx = await editorData();
const sourceDocument = () => presetDocument(ctx.presets.presets[0], ctx);
const directory = root => join(root, 'work/studio/panel-revisions/panel-fixture/settings-landscape');
const input = { artifactId: 'panel-fixture', variantKey: 'settings-landscape' };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'panel-revisions-'));
  const source = {
    kind: 'ui_panel_edit_source', version: '1.0', artifactId: input.artifactId,
    previewSha256: 'a'.repeat(64), source: 'offline-fixtures', ctx,
    pack: { manifestSha256: 'b'.repeat(64) },
    variants: [{ key: input.variantKey, label: '设置面板', document: sourceDocument(), behavior: { fields: [], actions: [{ id: 'save', action: 'submit' }] } }],
  };
  const store = createPanelRevisionStore(root, async artifactId => {
    if (artifactId !== source.artifactId) throw Error('SOURCE_UNAVAILABLE');
    return structuredClone(source);
  });
  const candidate = sizeEditDocument(source.variants[0].document, { nodeId: 'intro', width: 560 }, ctx);
  const save = (document = candidate, expectedRevision = null, extra = {}) => store.save({ ...input, sourceSha256: source.previewSha256, expectedRevision, document, ...extra });
  try { await run({ root, source, store, candidate, save }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('panel size copies reopen from immutable source-bound revisions and preserve authoring behavior', async () => {
  await fixture(async ({ root, source, store, candidate, save }) => {
    await mkdir(join(root, 'frozen'), { recursive: true });
    for (const file of ['preview.html', 'manifest.json', 'receipt.json']) await writeFile(join(root, 'frozen', file), 'immutable-' + file);
    const initial = await store.load(input);
    assert.equal(initial.revisionId, null);
    assert.deepEqual(initial.document, validateDocument(sourceDocument(), ctx));
    const first = await save();
    assert.match(first.revisionId, /^[a-f0-9-]{36}$/);
    assert.match(first.docSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(first.docSha256, initial.docSha256);
    assert.deepEqual(first.document, candidate);
    assert.deepEqual(Object.keys(first).sort(), ['docSha256', 'document', 'revisionId']);
    const firstBytes = await readFile(join(directory(root), first.revisionId + '.json'));
    const record = JSON.parse(firstBytes);
    assert.equal(record.previewSha256, source.previewSha256);
    assert.equal(record.skinSha256, source.pack.manifestSha256);
    assert.deepEqual(record.authoring.behavior, source.variants[0].behavior);
    assert.equal(record.modelCalls, 0);
    assert.equal(record.parentRevision, null);
    assert.equal(record.sequence, 1);
    assert.deepEqual(await createPanelRevisionStore(root, async () => structuredClone(source)).load(input), first);
    const nextDocument = sizeEditDocument(candidate, { nodeId: 'intro', width: 568 }, ctx);
    const second = await save(nextDocument, first.revisionId);
    const secondRecord = JSON.parse(await readFile(join(directory(root), second.revisionId + '.json')));
    assert.equal(secondRecord.parentRevision, first.revisionId);
    assert.equal(secondRecord.sequence, 2);
    assert.deepEqual(await store.load(input), second);
    assert.deepEqual(await readFile(join(directory(root), first.revisionId + '.json')), firstBytes);
    assert.deepEqual((await readdir(directory(root))).sort(), [first.revisionId + '.json', second.revisionId + '.json'].sort());
    for (const file of ['preview.html', 'manifest.json', 'receipt.json']) assert.equal(await readFile(join(root, 'frozen', file), 'utf8'), 'immutable-' + file);
  });
});

test('stale and simultaneous saves cannot overwrite another accepted revision', async () => {
  await fixture(async ({ root, store, save }) => {
    const settled = await Promise.allSettled([save(), save()]);
    assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
    const failure = settled.find(item => item.status === 'rejected').reason;
    assert.ok(['PANEL_REVISION_BUSY', 'PANEL_REVISION_STALE'].includes(failure.code));
    const current = await store.load(input);
    await assert.rejects(save(undefined, null), { code: 'PANEL_REVISION_STALE' });
    assert.deepEqual(await store.load(input), current);
    assert.equal((await readdir(directory(root))).filter(file => file.endsWith('.json')).length, 1);
  });
});

test('display text and size save in one revision chain without changing frozen source or behavior', async () => {
  await fixture(async ({ root, source, store, save }) => {
    const original=structuredClone(source),document=source.variants[0].document;
    const text=textEditDocument(document,{nodeId:'intro',changes:{text:'可编辑的新文案'}},ctx),first=await save(text);
    assert.equal((await store.load(input)).document.nodes.find(node=>node.id==='intro').props.text,'可编辑的新文案');
    const resized=sizeEditDocument(text,{nodeId:'intro',width:560},ctx),second=await save(resized,first.revisionId);
    const captions=textEditDocument(resized,{nodeId:'confirm',changes:{label:'应用'}},ctx),third=await save(captions,second.revisionId);
    const reopened=await createPanelRevisionStore(root,async()=>structuredClone(source)).load(input);
    assert.deepEqual(reopened,third);assert.equal(reopened.document.nodes.find(node=>node.id==='intro').size.width,560);assert.equal(reopened.document.nodes.find(node=>node.id==='confirm').props.label,'应用');
    const record=JSON.parse(await readFile(join(directory(root),third.revisionId+'.json')));
    assert.deepEqual(record.authoring.behavior,original.variants[0].behavior);assert.equal(record.sequence,3);assert.equal(record.parentRevision,second.revisionId);assert.equal(record.modelCalls,0);assert.deepEqual(source,original);
  });
});

test('a text copy with tampered behavior is rejected while the prior valid display copy remains usable', async () => {
  await fixture(async ({ root, source, store, save }) => {
    const original=structuredClone(source),firstText=textEditDocument(source.variants[0].document,{nodeId:'confirm',changes:{label:'先应用'}},ctx),first=await save(firstText);
    const secondText=textEditDocument(firstText,{nodeId:'confirm',changes:{label:'再应用'}},ctx),second=await save(secondText,first.revisionId);
    const path=join(directory(root),second.revisionId+'.json'),record=JSON.parse(await readFile(path));record.authoring.behavior.actions[0].action='erase';await writeFile(path,JSON.stringify(record));
    const reopened=await store.load(input);assert.deepEqual(reopened,first);assert.equal(reopened.document.nodes.find(node=>node.id==='confirm').props.label,'先应用');assert.deepEqual(source,original);
  });
});

test('font and exact color overrides reopen with the copy and restore by omission without changing source or behavior',async()=>{
  await fixture(async({root,source,store,save})=>{
    const original=structuredClone(source),document=source.variants[0].document;
    const styled=textEditDocument(document,{nodeId:'intro',changes:{text:'标题',fontSize:20,textColor:'#Ab12Ef'}},ctx),first=await save(styled);
    const reopened=await createPanelRevisionStore(root,async()=>structuredClone(source)).load(input),node=reopened.document.nodes.find(node=>node.id==='intro');
    assert.equal(node.props.fontSize,20);assert.equal(node.props.textColor,'#Ab12Ef');assert.equal(node.props.text,'标题');
    const restored=textEditDocument(reopened.document,{nodeId:'intro',changes:{fontSize:null,textColor:null}},ctx),second=await save(restored,first.revisionId);
    const current=await store.load(input),props=current.document.nodes.find(node=>node.id==='intro').props;
    assert.equal(Object.hasOwn(props,'fontSize'),false);assert.equal(Object.hasOwn(props,'textColor'),false);assert.equal(props.text,'标题');
    const records=await Promise.all([first,second].map(async copy=>JSON.parse(await readFile(join(directory(root),copy.revisionId+'.json')))));
    assert.equal(records[0].sourceDocSha256,records[1].sourceDocSha256);assert.equal(records[1].parentRevision,first.revisionId);
    for(const record of records){assert.deepEqual(record.authoring.behavior,original.variants[0].behavior);assert.equal(record.modelCalls,0);}
    assert.deepEqual(source,original);
  });
});

test('server rejects source changes, invalid geometry and non-display props without publishing a copy', async () => {
  await fixture(async ({ root, source, store, save }) => {
    await assert.rejects(save(undefined, null, { sourceSha256: 'c'.repeat(64) }), { code: 'PANEL_REVISION_SOURCE_CHANGED' });
    await assert.rejects(save(undefined, null, { expectedRevision: undefined }), { code: 'PANEL_REVISION_EXPECTED_INVALID' });
    for (const mutate of [
      doc => { doc.nodes.find(node => node.id === 'intro').props.align = 'right'; },
      doc => { doc.nodes.find(node => node.id === 'intro').size.width = 1; },
      doc => { doc.bindings.sha256 = 'c'.repeat(64); },
      doc => { doc.nodes.find(node => node.id === 'settings-body').layout.direction = 'row'; },
      doc => { doc.nodes.push(structuredClone(doc.nodes[0])); },
    ]) {
      const document = structuredClone(source.variants[0].document);
      mutate(document);
      await assert.rejects(save(document));
    }
    assert.equal((await store.load(input)).revisionId, null);
    assert.equal((await readdir(directory(root))).length, 0);
    const unavailable = createPanelRevisionStore(root, async () => { throw Error('SOURCE_VALIDATION_FAILED'); });
    await assert.rejects(unavailable.save({ ...input, sourceSha256: source.previewSha256, expectedRevision: null, document: sourceDocument() }), /SOURCE_VALIDATION_FAILED/);
    assert.equal((await readdir(directory(root))).length, 0);
  });
});

test('record storage excludes transport, private fields and play state while keeping only explicit public provenance', async () => {
  await fixture(async ({ root, source, save }) => {
    source.planSha256 = 'd'.repeat(64);
    source.transport = { token: 'do-not-store' };
    source.rawPayload = { privatePath: 'do-not-store' };
    source.ctx.privateSession = 'do-not-store';
    const result = await save(undefined, null, { playState: { save: { value: 'do-not-store' } } });
    const bytes = await readFile(join(directory(root), result.revisionId + '.json'), 'utf8');
    assert.ok(!bytes.includes('do-not-store'));
    const record = JSON.parse(bytes);
    assert.equal(record.planSha256, source.planSha256);
    assert.deepEqual(Object.keys(record.authoring).sort(), ['behavior', 'document']);
    for (const key of ['ctx', 'pack', 'transport', 'rawPayload', 'playState', 'previewBytes']) assert.ok(!Object.hasOwn(record, key));
  });
});

test('reopening skips interrupted or changed records and never accepts behavior changes or broken parent chains', async () => {
  await fixture(async ({ root, store, save, candidate }) => {
    const current = await save();
    const original = JSON.parse(await readFile(join(directory(root), current.revisionId + '.json')));
    await writeFile(join(directory(root), randomUUID() + '.json'), '{"kind":');
    const unpublished = structuredClone(original);
    unpublished.revisionId = randomUUID();
    unpublished.parentRevision = current.revisionId;
    unpublished.sequence = 2;
    // Even a fully written and otherwise valid staging record is not committed
    // until the publisher has synced/closed it and renamed it to its final UUID.
    await writeFile(join(directory(root), '.pending-' + unpublished.revisionId + '.json'), JSON.stringify(unpublished));
    await writeFile(join(directory(root), '.pending-' + randomUUID() + '.json'), '{"kind":');
    for (const mutate of [
      record => { record.authoring.behavior.actions[0].action = 'erase'; },
      record => { record.docSha256 = '0'.repeat(64); },
      record => { record.parentRevision = randomUUID(); record.sequence = 2; },
      record => { record.authoring.document.nodes.find(node => node.id === 'intro').props.text = 'tampered'; },
    ]) {
      const record = structuredClone(original);
      record.revisionId = randomUUID();
      mutate(record);
      await writeFile(join(directory(root), record.revisionId + '.json'), JSON.stringify(record));
    }
    assert.deepEqual(await store.load(input), current);
    const next = await save(sizeEditDocument(candidate, { nodeId: 'intro', width: 568 }, ctx), current.revisionId);
    assert.deepEqual(await store.load(input), next);
  });
});

test('independent variants stay isolated and unsafe identifiers, busy writes and filesystem links fail closed', async () => {
  await fixture(async ({ root, source, store, save }) => {
    source.variants.push({ ...structuredClone(source.variants[0]), key: 'other-landscape' });
    await save();
    const other = { ...input, variantKey: 'other-landscape' };
    assert.equal((await store.load(other)).revisionId, null);
    for (const patch of [{ artifactId: '../panel' }, { variantKey: '..' }, { variantKey: '../settings' }, { variantKey: 'CON' }, { variantKey: 'bad/key' }]) {
      await assert.rejects(store.load({ ...input, ...patch }), { code: 'PANEL_REVISION_ID_INVALID' });
    }
    await assert.rejects(store.load({ ...input, variantKey: 'unavailable' }), { code: 'PANEL_REVISION_VARIANT_UNAVAILABLE' });
    await writeFile(join(directory(root), '.save.lock'), 'busy');
    await assert.rejects(save(), { code: 'PANEL_REVISION_BUSY' });
    const linkedRoot = await mkdtemp(join(tmpdir(), 'panel-revisions-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'panel-revisions-outside-'));
    try {
      await symlink(outside, join(linkedRoot, 'work'), 'junction');
      const linked = createPanelRevisionStore(linkedRoot, async () => structuredClone(source));
      await assert.rejects(linked.load(input), { code: 'PANEL_REVISION_PATH_INVALID' });
      await assert.rejects(linked.save({ ...input, sourceSha256: source.previewSha256, expectedRevision: null, document: sourceDocument() }), { code: 'PANEL_REVISION_PATH_INVALID' });
      assert.deepEqual(await readdir(outside), []);
    } finally {
      await rm(linkedRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('a second apparently valid history branch is rejected rather than silently selecting one copy', async () => {
  await fixture(async ({ root, store, save }) => {
    const current = await save();
    const fork = JSON.parse(await readFile(join(directory(root), current.revisionId + '.json')));
    fork.revisionId = randomUUID();
    await writeFile(join(directory(root), fork.revisionId + '.json'), JSON.stringify(fork));
    await assert.rejects(store.load(input), { code: 'PANEL_REVISION_BRANCH_CONFLICT' });
    await assert.rejects(save(undefined, current.revisionId), { code: 'PANEL_REVISION_BRANCH_CONFLICT' });
    assert.equal((await readdir(directory(root))).length, 2);
  });
});

test('staging sync and publication failures leave no accepted copy or save lock', async () => {
  for (const stage of ['sync', 'close', 'rename']) {
    await fixture(async ({ root, store, save }) => {
      const originalOpen = filesystem.open;
      const fault = stage === 'rename' ? mock.method(filesystem, 'rename', async () => { throw Object.assign(Error('simulated publication failure'), { code: 'EIO' }); }) :
        mock.method(filesystem, 'open', async (...args) => {
          const handle = await originalOpen(...args);
          if (String(args[0]).includes('.pending-')) {
            const originalClose = handle.close.bind(handle);
            handle[stage] = async () => {
              if (stage === 'close') await originalClose();
              throw Object.assign(Error('simulated staging failure'), { code: 'EIO' });
            };
          }
          return handle;
        });
      syncBuiltinESMExports();
      try { await assert.rejects(save(), { code: 'EIO' }); }
      finally { fault.mock.restore(); syncBuiltinESMExports(); }
      assert.deepEqual(await readdir(directory(root)), []);
      assert.equal((await store.load(input)).revisionId, null);
      const accepted = await save();
      assert.deepEqual(await store.load(input), accepted);
      assert.deepEqual(await readdir(directory(root)), [accepted.revisionId + '.json']);
    });
  }
});
