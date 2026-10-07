// A deliberately small static SVG language, not a sanitizer for arbitrary XML.
// Every tag, attribute and resource reference is parsed and allowlisted before rasterization.
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUM_TOKEN = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /^[A-Za-z][A-Za-z0-9:-]*/;
const PAINT = ['id', 'transform', 'color', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'filter'];
const ALLOWED = {
  svg: [...PAINT, 'xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio'], g: PAINT, defs: ['id'],
  path: [...PAINT, 'd'], rect: [...PAINT, 'x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: [...PAINT, 'cx', 'cy', 'r'], ellipse: [...PAINT, 'cx', 'cy', 'rx', 'ry'],
  line: [...PAINT, 'x1', 'x2', 'y1', 'y2'], polyline: [...PAINT, 'points'], polygon: [...PAINT, 'points'],
  linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
  radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  filter: ['id', 'x', 'y', 'width', 'height', 'color-interpolation-filters'], feGaussianBlur: ['stdDeviation'],
};
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const ws = char => char !== undefined && /[\t\n\r ]/.test(char);
function number(value, min = -1000000, max = 1000000) {
  if (!NUMBER.test(value)) fail('ASSET_SVG_NUMBER');
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail('ASSET_SVG_NUMBER');
  return n;
}
function numbers(value, min = -1000000, max = 1000000) {
  const items = value.trim().split(/[\t\n\r ,]+/);
  if (!items.length || items.length > 8192) fail('ASSET_SVG_LIMIT');
  return items.map(item => number(item, min, max));
}
function percentNumber(value, min, max) {
  return value.endsWith('%') ? number(value.slice(0, -1), min * 100, max * 100) / 100 : number(value, min, max);
}
function color(value) {
  if (!/^(?:none|black|white|transparent|#[a-fA-F0-9]{3}|#[a-fA-F0-9]{4}|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8})$/.test(value)) fail('ASSET_SVG_PAINT');
}
function transform(value) {
  let rest = value.trim(), count = 0;
  while (rest) {
    const match = /^(matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/.exec(rest);
    if (!match || ++count > 32) fail('ASSET_SVG_TRANSFORM');
    const n = numbers(match[2]);
    const counts = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
    if (!counts[match[1]].includes(n.length)) fail('ASSET_SVG_TRANSFORM');
    rest = rest.slice(match[0].length).trimStart();
  }
  if (!count) fail('ASSET_SVG_TRANSFORM');
}
function pathData(value) {
  let pos = 0, first = true, comma = false;
  const tokens = [];
  while (pos < value.length) {
    if (ws(value[pos])) { pos++; continue; }
    if (value[pos] === ',') {
      if (comma || typeof tokens.at(-1) !== 'number') fail('ASSET_SVG_PATH');
      comma = true; pos++; continue;
    }
    if (tokens.length >= 16384) fail('ASSET_SVG_LIMIT');
    const c = value[pos];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      if (comma || first && !/[Mm]/.test(c)) fail('ASSET_SVG_PATH');
      first = false; tokens.push(c); pos++; continue;
    }
    if (first) fail('ASSET_SVG_PATH');
    NUM_TOKEN.lastIndex = pos;
    const token = NUM_TOKEN.exec(value);
    if (!token) fail('ASSET_SVG_PATH');
    tokens.push(number(token[0])); comma = false; pos = NUM_TOKEN.lastIndex;
  }
  if (first || comma) fail('ASSET_SVG_PATH');
  const arity = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  for (let i = 0; i < tokens.length;) {
    if (typeof tokens[i] !== 'string') fail('ASSET_SVG_PATH');
    const command = tokens[i++].toLowerCase(), start = i;
    while (i < tokens.length && typeof tokens[i] === 'number') i++;
    const count = i - start, size = arity[command];
    if (size === 0 ? count !== 0 : count === 0 || count % size !== 0) fail('ASSET_SVG_PATH');
    if (command === 'a') for (let j = start; j < i; j += 7) {
      if (tokens[j] < 0 || tokens[j + 1] < 0 || ![0, 1].includes(tokens[j + 3]) || ![0, 1].includes(tokens[j + 4])) fail('ASSET_SVG_PATH');
    }
  }
}

export function validateAssetSvg(text, { width, height }) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024 || !text.isWellFormed()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('ASSET_SVG_INPUT');
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 4096) || width * height > 16777216) fail('ASSET_SVG_DIMENSIONS');
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0, nodes = 0, rootSeen = false;
  const stack = [], ids = new Map(), refs = [], filterChildren = new Map();
  const space = () => { while (ws(text[pos])) pos++; };
  function inspect(tag, attrs, parent) {
    if (!Object.hasOwn(ALLOWED, tag)) fail('ASSET_SVG_TAG');
    if (tag === 'svg') {
      if (rootSeen || parent) fail('ASSET_SVG_ROOT');
      rootSeen = true;
      if (attrs.xmlns !== 'http://www.w3.org/2000/svg' || !attrs.viewBox) fail('ASSET_SVG_ROOT');
      const box = numbers(attrs.viewBox);
      if (box.length !== 4 || box[2] <= 0 || box[3] <= 0) fail('ASSET_SVG_VIEWBOX');
      for (const [key, dimension] of [['width', width], ['height', height]]) {
        if (attrs[key] !== undefined && number(attrs[key].replace(/px$/, ''), 1, 4096) !== dimension) fail('ASSET_SVG_DIMENSIONS');
      }
    } else {
      const validParent = tag === 'stop' ? ['linearGradient', 'radialGradient'].includes(parent?.tag)
        : tag === 'feGaussianBlur' ? parent?.tag === 'filter'
          : ['linearGradient', 'radialGradient', 'filter'].includes(tag) ? parent?.tag === 'defs'
            : ['svg', 'g'].includes(parent?.tag);
      if (!validParent) fail('ASSET_SVG_STRUCTURE');
    }
    if (tag === 'path' && !attrs.d || ['polygon', 'polyline'].includes(tag) && !attrs.points) fail('ASSET_SVG_GEOMETRY');
    if (tag === 'feGaussianBlur') {
      if (!attrs.stdDeviation) fail('ASSET_SVG_FILTER');
      const count = (filterChildren.get(parent) ?? 0) + 1; filterChildren.set(parent, count);
      if (count > 1) fail('ASSET_SVG_FILTER');
    }
    for (const [name, value] of Object.entries(attrs)) {
      if (!ALLOWED[tag].includes(name)) fail('ASSET_SVG_ATTRIBUTE');
      if (name === 'xmlns' || name === 'viewBox') continue;
      if (name === 'id') {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) || ids.has(value)) fail('ASSET_SVG_ID');
        ids.set(value, tag); continue;
      }
      if (name === 'fill' || name === 'stroke' || name === 'filter') {
        const ref = /^url\(#([A-Za-z][A-Za-z0-9_-]{0,63})\)$/.exec(value);
        if (ref) refs.push({ id: ref[1], type: name === 'filter' ? 'filter' : 'gradient' });
        else if (name === 'filter') { if (value !== 'none') fail('ASSET_SVG_REFERENCE'); }
        else if (value !== 'currentColor') color(value);
        continue;
      }
      if (name === 'transform' || name === 'gradientTransform') { transform(value); continue; }
      if (name === 'd') { pathData(value); continue; }
      if (name === 'points') { const n = numbers(value); if (n.length < 4 || n.length % 2) fail('ASSET_SVG_GEOMETRY'); continue; }
      if (name === 'stop-color' || name === 'color') { color(value); continue; }
      if (name === 'preserveAspectRatio') {
        if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value)) fail('ASSET_SVG_ATTRIBUTE_VALUE');
        continue;
      }
      if (['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity'].includes(name)) { number(value, 0, 1); continue; }
      if (name === 'offset') { percentNumber(value, 0, 1); continue; }
      const enums = { 'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
        'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'], gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'],
        spreadMethod: ['pad', 'reflect', 'repeat'], 'color-interpolation-filters': ['sRGB', 'linearRGB'] };
      if (Object.hasOwn(enums, name)) { if (!enums[name].includes(value)) fail('ASSET_SVG_ATTRIBUTE_VALUE'); continue; }
      if (name === 'stroke-dasharray') { if (value !== 'none' && numbers(value, 0).length > 64) fail('ASSET_SVG_LIMIT'); continue; }
      if (name === 'stdDeviation') { if (numbers(value, 0, 256).length > 2) fail('ASSET_SVG_FILTER'); continue; }
      if (tag === 'filter') {
        if (value.endsWith('%')) number(value.slice(0, -1), ['width', 'height'].includes(name) ? 1 : -100, 200);
        else number(value, ['width', 'height'].includes(name) ? 0.0001 : -4096, 8192);
        continue;
      }
      if (tag.endsWith('Gradient')) { percentNumber(value, ['r', 'fr'].includes(name) ? 0 : -1000000, 1000000); continue; }
      if (tag === 'svg' && ['width', 'height'].includes(name)) continue;
      number(value, ['width', 'height', 'r', 'rx', 'ry', 'stroke-width', 'stroke-miterlimit'].includes(name) ? 0 : -1000000);
    }
  }
  while (pos < text.length) {
    space(); if (pos === text.length) break;
    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4);
      if (end < 0 || text.slice(pos + 4, end).includes('--')) fail('ASSET_SVG_XML');
      pos = end + 3; continue;
    }
    if (text.startsWith('</', pos)) {
      pos += 2; const match = NAME.exec(text.slice(pos));
      if (!match || !stack.length || match[0] !== stack.at(-1).tag) fail('ASSET_SVG_XML');
      pos += match[0].length; space(); if (text[pos++] !== '>') fail('ASSET_SVG_XML');
      stack.pop(); continue;
    }
    if (text[pos++] !== '<') fail('ASSET_SVG_XML');
    const match = NAME.exec(text.slice(pos));
    if (!match) fail('ASSET_SVG_XML'); // Reject DTD, entities and processing instructions.
    const tag = match[0]; pos += tag.length;
    const attrs = Object.create(null); let selfClosing = false, count = 0;
    while (true) {
      const before = pos; space();
      if (text.startsWith('/>', pos)) { pos += 2; selfClosing = true; break; }
      if (text[pos] === '>') { pos++; break; }
      if (pos === before || ++count > 32) fail('ASSET_SVG_XML');
      const attr = NAME.exec(text.slice(pos)); if (!attr) fail('ASSET_SVG_XML');
      const name = attr[0]; pos += name.length; space();
      if (text[pos++] !== '=') fail('ASSET_SVG_XML'); space();
      const quote = text[pos++]; if (quote !== '"' && quote !== "'") fail('ASSET_SVG_XML');
      const end = text.indexOf(quote, pos);
      if (end < 0 || end - pos > 65536 || Object.hasOwn(attrs, name)) fail('ASSET_SVG_XML');
      const value = text.slice(pos, end);
      if (/[<>&]/.test(value)) fail('ASSET_SVG_XML');
      attrs[name] = value; pos = end + 1;
    }
    if (++nodes > 4096 || stack.length >= 64) fail('ASSET_SVG_LIMIT');
    inspect(tag, attrs, stack.at(-1));
    if (!selfClosing) stack.push({ tag });
  }
  if (!rootSeen || stack.length) fail('ASSET_SVG_XML');
  for (const ref of refs) {
    const tag = ids.get(ref.id);
    if (ref.type === 'filter' ? tag !== 'filter' : !['linearGradient', 'radialGradient'].includes(tag)) fail('ASSET_SVG_REFERENCE');
  }
  return text;
}
