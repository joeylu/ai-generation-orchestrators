import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioBuildInfo, validateStudioBuildInfo, detectStudioBuild, studioBuildMarkup, studioHtmlTemplate } from '../src/studio-build-info.mjs';
const inputs = { shellSha256: 'a'.repeat(64), scriptSha256: 'b'.repeat(64) };
const build = await createStudioBuildInfo('0.1.0', inputs);
const local = { protocol: 'http:', hostname: '127.0.0.1' };

test('build identity changes with code, content or version; unsafe labels are rejected', async () => {
  assert.deepEqual(await createStudioBuildInfo('0.1.0', inputs), build);
  for (const changed of [{ ...inputs, shellSha256: 'c'.repeat(64) }, { ...inputs, scriptSha256: 'd'.repeat(64) }]) {
    assert.notEqual((await createStudioBuildInfo('0.1.0', changed)).buildSha256, build.buildSha256);
  }
  assert.notEqual((await createStudioBuildInfo('0.2.0', inputs)).buildSha256, build.buildSha256);
  assert.deepEqual(validateStudioBuildInfo(build), build);
  assert.throws(() => validateStudioBuildInfo({ ...build, path: 'private' }));
  assert.throws(() => validateStudioBuildInfo({ ...build, appVersion: '"><script>' }));
  await assert.rejects(createStudioBuildInfo('0.1.0', { ...inputs, scriptSha256: 'invalid' }));
});

test('normalization removes only the exact build label and retains all CSS, copy and seed bytes', () => {
  const surrounding = ['<style>.a{color:red}</style>', '<script type="application/json">{"catalog":"a"}</script>'];
  const html = surrounding.join(studioBuildMarkup(build));
  assert.equal(studioHtmlTemplate(html, build), surrounding.join(studioBuildMarkup()));
  assert.throws(() => studioHtmlTemplate(html + studioBuildMarkup(build), build));
  assert.throws(() => studioHtmlTemplate(html.replace('v0.1.0', 'v9.9.9'), build));
});

test('version check only reads local metadata; file and remote previews do not probe a service', async () => {
  let calls = 0;
  const fetcher = async (path, options) => {
    calls++; assert.equal(path, '/api/panel/studio'); assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    return Response.json({ protocol: '0.1', kind: 'ui-panel-studio', build, active: false });
  };
  assert.equal(await detectStudioBuild({ protocol: 'file:', hostname: '' }, fetcher), null);
  assert.equal(await detectStudioBuild({ protocol: 'https:', hostname: 'example.test' }, fetcher), null);
  assert.equal(calls, 0);
  assert.deepEqual(await detectStudioBuild(local, fetcher), build); assert.equal(calls, 1);
});

test('legacy, unavailable and malformed local metadata never invent a version', async () => {
  for (const response of [new Response('', { status: 404 }), new Response('not json'),
    Response.json({ protocol: '0.1', kind: 'ui-panel-studio', build: null }),
    Response.json({ protocol: '9', kind: 'ui-panel-studio', build }),
    Response.json({ protocol: '0.1', kind: 'other', build }),
    Response.json({ protocol: '0.1', kind: 'ui-panel-studio', build: { ...build, buildSha256: 'bad' } }),
    Response.json({ text: 'x'.repeat(5000) })]) {
    assert.equal(await detectStudioBuild(local, async () => response), null);
  }
  assert.equal(await detectStudioBuild(local, async () => { throw new TypeError('offline'); }), null);
});
