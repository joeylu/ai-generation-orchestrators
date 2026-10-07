import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAssetSvg } from '../src/asset-svg.mjs';

const size = { width: 64, height: 64 };
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">${body}</svg>`;
const rejects = text => assert.throws(() => validateAssetSvg(text, size), error => typeof error.code === 'string' && error.code.startsWith('ASSET_SVG_'));

test('path commands require complete numeric groups and valid arc flags', () => {
  for (const d of ['MZ', 'M1', 'M0 0 L1', 'M0 0 A2 2 0 3 4 10 10', 'M0 0 A-1 2 0 0 1 5 5', 'M,0,0', 'M0 0,', 'M0,,0']) rejects(svg(`<path d="${d}"/>`));
  assert.equal(validateAssetSvg(svg('<path d="M0 0 4 4L8 8A2 2 0 0 1 10 10Z"/>'), size), svg('<path d="M0 0 4 4L8 8A2 2 0 0 1 10 10Z"/>'));
});

test('static geometry and bounded transforms validate without rewriting source', () => {
  const source = svg(`<!-- fixture geometry -->
    <g transform="translate(1 2) scale(.8) rotate(10 12 12)" fill="#FFFFFF" stroke="black" stroke-width="1">
      <path d="M2 2L10 2C12 2 14 4 14 6Q14 8 10 8A2 2 0 0 1 8 10Z"/>
      <rect x="2" y="3" width="10" height="6" rx="2"/>
      <circle cx="5" cy="5" r="2"/><ellipse cx="8" cy="8" rx="3" ry="2"/>
      <line x1="1" y1="1" x2="9" y2="9"/>
      <polyline points="1,2 3,4 5,6"/><polygon points="1,1 8,1 4,8"/>
    </g>`);
  assert.equal(validateAssetSvg(source, size), source);
});

test('local linear and radial gradients can be referenced by static geometry', () => {
  const source = svg(`<defs>
    <linearGradient id="linear" x1="0%" x2="100%" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#123"/><stop offset="100%" stop-color="#abcdef" stop-opacity=".5"/></linearGradient>
    <radialGradient id="radial" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="transparent"/></radialGradient>
    </defs><rect width="24" height="24" fill="url(#linear)"/><circle cx="12" cy="12" r="6" fill="url(#radial)"/>`);
  assert.equal(validateAssetSvg(source, size), source);
});

test('finite Gaussian blur is allowed while excessive or repeated blur is rejected', () => {
  const body = '<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2 3"/></filter></defs><circle cx="12" cy="12" r="6" filter="url(#soft)"/>';
  assert.equal(validateAssetSvg(svg(body), size), svg(body));
  for (const deviation of ['257', '-1', 'Infinity', '1 2 3']) rejects(svg(body.replace('2 3', deviation)));
  rejects(svg(body.replace('<feGaussianBlur stdDeviation="2 3"/>', '<feGaussianBlur stdDeviation="2"/><feGaussianBlur stdDeviation="1"/>')));
});

test('DTD, entities, external references, active markup, text, styles and events are rejected', () => {
  for (const source of [
    '<!DOCTYPE svg>' + svg('<rect width="2" height="2"/>'),
    '<!DOCTYPE svg [<!ENTITY x "value">]>' + svg('<rect width="2" height="2"/>'),
    svg('<rect width="2" height="2" fill="&x;"/>'),
    svg('<rect width="2" height="2" href="https://example.invalid/image.png"/>'),
    svg('<script/>'), svg('<style/>'), svg('<text>Hello</text>'),
    svg('<rect width="2" height="2" style="fill:red"/>'),
    svg('<rect width="2" height="2" onclick="run()"/>'),
    svg('<rect width="2" height="2" fill="url(https://example.invalid/paint)"/>'),
  ]) rejects(source);
});

test('invalid hierarchy, duplicate attributes and malformed closing tags are rejected', () => {
  for (const body of [
    '<stop offset="0" stop-color="white"/>',
    '<linearGradient id="wrong"><stop offset="0" stop-color="white"/></linearGradient>',
    '<feGaussianBlur stdDeviation="1"/>',
    '<rect width="4" height="4"><circle r="1"/></rect>',
    '<rect width="4" width="5" height="4"/>',
    '<g><path d="M1 1L2 2"/></rect>',
  ]) rejects(svg(body));
  rejects(svg('') + svg(''));
});

test('paint and filter references must resolve to a unique local definition of the right type', () => {
  rejects(svg('<rect width="4" height="4" fill="url(#missing)"/>'));
  rejects(svg('<g id="paint"/><rect width="4" height="4" fill="url(#paint)"/>'));
  rejects(svg('<defs><filter id="same"/><linearGradient id="same"/></defs>'));
  rejects(svg('<defs><linearGradient id="paint"/></defs><rect width="4" height="4" filter="url(#paint)"/>'));
});

test('dimensions, view boxes and resource limits reject out-of-bounds input', () => {
  for (const invalidSize of [{ width: 0, height: 64 }, { width: 4097, height: 64 }, { width: 64, height: NaN }, { width: 1.5, height: 64 }]) {
    assert.throws(() => validateAssetSvg(svg(''), invalidSize), { code: 'ASSET_SVG_DIMENSIONS' });
  }
  rejects(svg('').replace('width="64"', 'width="65"'));
  rejects(svg('').replace('0 0 24 24', '0 0 0 24'));
  rejects(svg('<g>'.repeat(65) + '</g>'.repeat(65)));
  rejects(svg('<rect width="1" height="1"/>'.repeat(4096)));
  rejects(svg('<!--' + 'x'.repeat(1024 * 1024) + '-->'));
});

test('path numbers must be finite, bounded and lexically valid', () => {
  for (const data of ['M1e309 0', 'M1000001 0', 'MNaN 0', 'MInfinity 0', 'L1 1', 'M1 1X2 2', '']) {
    rejects(svg(`<path d="${data}"/>`));
  }
  const source = svg('<path d="M.5-.5L1e2 1e-2H+2V3z"/>');
  assert.equal(validateAssetSvg(source, size), source);
  rejects(svg('<circle cx="12" cy="12" r="-1"/>'));
});
