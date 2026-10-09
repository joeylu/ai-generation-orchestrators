/** Portable build identity. No paths, process IDs, timestamps or provider state. */
import { digestJson } from './canonical.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = () => { throw Object.assign(new Error('STUDIO_BUILD_INFO'), { code: 'STUDIO_BUILD_INFO' }); };
export async function createStudioBuildInfo(appVersion, inputs) {
  if (typeof appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(appVersion)
      || !hash(inputs?.shellSha256) || !hash(inputs?.scriptSha256)) fail();
  return { studioBuildVersion: '0.1', appVersion,
    buildSha256: await digestJson({ appVersion, shellSha256: inputs.shellSha256, scriptSha256: inputs.scriptSha256 }) };
}
export function validateStudioBuildInfo(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'appVersion,buildSha256,studioBuildVersion'
      || value.studioBuildVersion !== '0.1' || typeof value.appVersion !== 'string'
      || !/^\d+\.\d+\.\d+$/.test(value.appVersion) || !hash(value.buildSha256)) fail();
  return { ...value };
}
export function studioBuildMarkup(value = null) {
  const info = value === null ? null : validateStudioBuildInfo(value);
  return `<p id="studio-version" class="hint" data-build="${info?.buildSha256 ?? ''}">${info ? `v${info.appVersion} · 构建 ${info.buildSha256.slice(0, 12)}` : ''}</p>`;
}
export function studioHtmlTemplate(html, info) {
  const markup = studioBuildMarkup(info);
  if (typeof html !== 'string' || html.split(markup).length !== 2) fail();
  return html.replace(markup, studioBuildMarkup());
}

/** Read-only check, only on initial load, focus, or an explicit generation/edit click. */
export async function detectStudioBuild(location, fetcher = fetch) {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return null;
  try {
    const response = await fetcher('/api/panel/studio', { mode: 'same-origin', credentials: 'omit',
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(2000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) return null;
    const text = await response.text();
    if (text.length > 4096) return null;
    const value = JSON.parse(text);
    if (value.protocol !== '0.1' || value.kind !== 'ui-panel-studio') return null;
    return value.build === null ? null : validateStudioBuildInfo(value.build);
  } catch { return null; }
}
