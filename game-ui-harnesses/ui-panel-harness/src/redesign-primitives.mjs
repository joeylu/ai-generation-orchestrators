// Original vector recipes. Source filenames identify roles; no source pixels are read.
const SIZES = new Set([32, 64, 128, 256, 512, 1024]);
const EDGES = ['left', 'bottom', 'right', 'top'];
const SHADOWS = new Set(['Flat Shadow', 'Horizontal Shadow', 'Horizontal Shadow (Normal)', 'Horizontal Shadow (High)', 'Radial Shadow', 'Vertical Shadow']);
const DEMOS = new Set(['MUIP', 'MUIP Big', 'Discord', 'Demo Welcome']);

function object(input, allowed, name) {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError(`${name} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptors[key]) || !descriptors[key].enumerable) throw new TypeError(`${name} contains an unsupported property`);
  }
  return input;
}

function dimensions(options) {
  object(options, ['width', 'height', 'color', 'border'], 'options');
  const { width, height, color = '#F1F5FC', border = null } = options;
  for (const value of [width, height]) if (!Number.isSafeInteger(value) || value < 1 || value > 8192) throw new RangeError('width and height must be integers in 1..8192');
  if (width * height > 33554432) throw new RangeError('texture area exceeds 32 megapixels');
  if (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color)) throw new TypeError('color must be #RRGGBB');
  if (border !== null) {
    object(border, EDGES, 'border');
    if (Object.keys(border).length !== 4 || EDGES.some(edge => !Number.isFinite(border[edge]) || border[edge] < 0 || border[edge] > 8192)) throw new RangeError('border must contain four finite nonnegative edges');
  }
  return { width, height, color, border };
}

function identify(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length > 160 || relativePath.includes('\\')) throw new TypeError('relativePath must be a canonical texture-relative path');
  const match = /^Border\/(Rounded|Radial)\/(\d+)px\/\1 (Filled|Outline) \2px(?: - (\d+)x)?\.png$/.exec(relativePath);
  if (match) {
    const nominalSize = Number(match[2]), outline = match[3] === 'Outline', weight = Number(match[4]);
    if (!SIZES.has(nominalSize) || (outline ? !Number.isInteger(weight) || weight < 1 || weight > 10 : match[4] !== undefined)) throw new TypeError('unsupported border variant');
    return { category: 'border', family: match[1], nominalSize, outline, weight };
  }
  if (relativePath === 'Border/Flat/Square Filled.png') return { category: 'border', family: 'Square' };
  if (relativePath === 'Border/Others/Modal Tab Button.png') return { category: 'border', family: 'Tab' };
  const special = /^(Shadow|Demo)\/([^/]+)\.png$/.exec(relativePath);
  if (special && (special[1] === 'Shadow' ? SHADOWS : DEMOS).has(special[2])) return { category: special[1].toLowerCase(), name: special[2] };
  throw new TypeError(`unsupported primitive path: ${relativePath.slice(0, 160)}`);
}

const n = value => Number(value.toFixed(4));
function svg(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}

function validBorder(border, width, height) {
  return border !== null && border.left + border.right < width && border.top + border.bottom < height;
}

function chooseBorder(source, width, height, desired, notes) {
  if (validBorder(source, width, height) && EDGES.every(edge => source[edge] >= desired[edge])) {
    notes.push('Source slice margins preserved after bounds and new-shape containment checks.');
    return { ...source };
  }
  if (source !== null) notes.push('Slice margins recomputed: source margins have no stretchable center or do not contain the redesigned corner.');
  return desired;
}

function borderRecipe(recipe, options) {
  const { width: w, height: h, color, border: source } = options;
  const d = Math.min(w, h), notes = ['Original vector tint mask on a transparent canvas.', 'Native prefab and nine-slice behavior require engine acceptance; this is a semantic replacement.'];
  let content, outputBorder;
  if (recipe.family === 'Square') {
    content = `<path fill="${color}" d="M0 0H${w}V${h}H0Z"/>`;
    outputBorder = chooseBorder(source, w, h, { left: 0, bottom: 0, right: 0, top: 0 }, notes);
  } else if (recipe.family === 'Radial') {
    const stroke = recipe.outline ? Math.max(Math.min(0.5, d / 4), d * recipe.weight / (recipe.nominalSize + recipe.weight)) : 0;
    const inset = stroke / 2;
    content = `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2 - inset)}" ry="${n(h / 2 - inset)}" fill="${recipe.outline ? 'none' : color}"${recipe.outline ? ` stroke="${color}" stroke-width="${n(stroke)}"` : ''}/>`;
    const x = Math.floor((w - 1) / 2), y = Math.floor((h - 1) / 2);
    outputBorder = chooseBorder(source, w, h, { left: x, bottom: y, right: x, top: y }, notes);
    notes.push('Radial masks remain circular under uniform scaling; nine-slice stretching intentionally produces a capsule.');
  } else {
    const stroke = recipe.outline ? Math.max(Math.min(0.5, d / 4), d * recipe.weight / (recipe.nominalSize + recipe.weight)) : 0;
    let radius = Math.min(d * 0.45, Math.max(d * 0.095, stroke * 1.35));
    // Accommodate safe source slices when their corner region is smaller than the default radius.
    const relevantEdges = recipe.family === 'Tab' ? ['left', 'top', 'right'] : EDGES;
    if (validBorder(source, w, h)) {
      const smallest = Math.min(...relevantEdges.map(edge => source[edge]));
      if (smallest >= stroke * 1.35 && smallest > 0) radius = Math.min(radius, smallest);
    }
    const edgeX = Math.min(Math.floor((w - 1) / 2), Math.ceil(radius));
    const edgeY = Math.min(Math.floor((h - 1) / 2), Math.ceil(radius));
    const desired = { left: edgeX, bottom: recipe.family === 'Tab' ? 0 : edgeY, right: edgeX, top: edgeY };
    outputBorder = chooseBorder(source, w, h, desired, notes);
    if (recipe.family === 'Tab') {
      content = `<path fill="${color}" d="M0 ${h}V${n(radius)}Q0 0 ${n(radius)} 0H${n(w - radius)}Q${w} 0 ${w} ${n(radius)}V${h}Z"/>`;
      notes.push('Tab mask has rounded upper corners and a flush lower edge.');
    } else {
      const inset = stroke / 2;
      content = `<rect x="${n(inset)}" y="${n(inset)}" width="${n(w - stroke)}" height="${n(h - stroke)}" rx="${n(Math.max(0, radius - inset))}" fill="${recipe.outline ? 'none' : color}"${recipe.outline ? ` stroke="${color}" stroke-width="${n(stroke)}"` : ''}/>`;
    }
  }
  if (recipe.nominalSize) notes.push(`Nominal ${recipe.nominalSize}px is a recipe scale label; output dimensions are ${w}×${h}.`);
  return { svg: svg(w, h, content), border: outputBorder, notes };
}

function shadowRecipe(recipe, options) {
  const { width: w, height: h, border: source } = options;
  const notes = ['Original black alpha shadow; no opaque background or source texture pixels.', 'Shadow strength is baked alpha; hosts may apply additional opacity.'];
  let content, outputBorder = null;
  if (recipe.name === 'Flat Shadow') {
    const d = Math.min(w, h), inset = d * 0.23, blur = d * 0.055, radius = d * 0.1;
    content = `<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${n(blur)}"/></filter></defs><rect x="${n(inset)}" y="${n(inset)}" width="${n(w - 2 * inset)}" height="${n(h - 2 * inset)}" rx="${n(radius)}" fill="#000000" opacity="0.26" filter="url(#soft)"/>`;
    const edge = Math.min(Math.floor((d - 1) / 2), Math.ceil(inset + radius));
    outputBorder = chooseBorder(source, w, h, { left: edge, bottom: edge, right: edge, top: edge }, notes);
  } else if (recipe.name === 'Radial Shadow') {
    content = '<defs><radialGradient id="shade"><stop offset="0" stop-color="#000000" stop-opacity="0.3"/><stop offset="0.24" stop-color="#000000" stop-opacity="0.25"/><stop offset="0.5" stop-color="#000000" stop-opacity="0.14"/><stop offset="0.73" stop-color="#000000" stop-opacity="0.05"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient></defs>';
    content += `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="url(#shade)"/>`;
    notes.push('Radial falloff is an unsliced ellipse; use uniform scaling to preserve circular falloff.');
  } else {
    const vertical = recipe.name === 'Vertical Shadow';
    const alpha = recipe.name.endsWith('(High)') ? 0.42 : recipe.name.endsWith('(Normal)') ? 0.26 : 0.18;
    const stops = [[0, 0], [0.15, 0.09], [0.3, 0.36], [0.5, 1], [0.7, 0.36], [0.85, 0.09], [1, 0]];
    content = `<defs><linearGradient id="shade" x1="0" y1="0" x2="${vertical ? 1 : 0}" y2="${vertical ? 0 : 1}">${stops.map(([offset, a]) => `<stop offset="${offset}" stop-color="#000000" stop-opacity="${n(alpha * a)}"/>`).join('')}</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#shade)"/>`;
    notes.push(`${vertical ? 'Vertical strip fades along X' : 'Horizontal strip fades along Y'}; unsliced to preserve the gradient.`);
  }
  return { svg: svg(w, h, content), border: outputBorder, notes };
}

// A small original monoline display alphabet keeps presentation exports font-independent.
const LETTERS = {
  C: 'M8 1H3Q1 1 1 3V9Q1 11 3 11H8', D: 'M1 11V1H4Q9 1 9 6T4 11Z',
  E: 'M8 1H1V11H8M1 6H6', I: 'M1 1H7M4 1V11M1 11H7',
  L: 'M1 1V11H8', M: 'M1 11V1L5 6L9 1V11', N: 'M1 11V1L9 11V1',
  O: 'M5 1Q1 1 1 5V7Q1 11 5 11T9 7V5Q9 1 5 1Z',
  P: 'M1 11V1H5Q9 1 9 4T5 7H1', R: 'M1 11V1H5Q9 1 9 4T5 7H1M5 7L9 11',
  T: 'M0 1H10M5 1V11', U: 'M1 1V7Q1 11 5 11T9 7V1',
  W: 'M0 1L2 11L5 6L8 11L10 1', Y: 'M0 1L5 6L10 1M5 6V11',
};

function lettering(word, x, y, height, color, weight = 1.2) {
  const scale = height / 12;
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(scale)})" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">${[...word].map((letter, i) => letter === ' ' ? '' : `<path transform="translate(${i * 13} 0)" d="${LETTERS[letter]}"/>`).join('')}</g>`;
}

function demoRecipe(recipe, { width: w, height: h }) {
  const mint = '#71DBC3', pale = '#F1F5FC', muted = '#8496B4';
  const worldW = recipe.name === 'Demo Welcome' ? 1600 : recipe.name === 'Discord' ? 400 : 964;
  const worldH = recipe.name === 'Demo Welcome' ? 900 : 400;
  let body = `<defs><linearGradient id="night" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1B2332"/><stop offset="1" stop-color="#111622"/></linearGradient><radialGradient id="glow"><stop stop-color="${mint}" stop-opacity="0.17"/><stop offset="1" stop-color="${mint}" stop-opacity="0"/></radialGradient></defs><rect width="${worldW}" height="${worldH}" rx="32" fill="url(#night)"/><ellipse cx="${worldW * 0.78}" cy="${worldH * 0.15}" rx="${worldW * 0.5}" ry="${worldH * 0.85}" fill="url(#glow)"/>`;
  if (recipe.name === 'Discord') {
    body += `<rect x="84" y="100" width="232" height="164" rx="46" fill="${mint}"/><path d="M160 258L138 305L208 264" fill="${mint}"/><path d="M139 157H262M139 196H224" fill="none" stroke="#12243A" stroke-width="16" stroke-linecap="round"/><circle cx="310" cy="88" r="20" fill="${pale}"/>`;
  } else if (recipe.name === 'Demo Welcome') {
    body += `<rect x="82" y="80" width="52" height="52" rx="16" fill="${mint}"/><path d="M96 119V92L108 107L121 92V119" fill="none" stroke="#12243A" stroke-width="4" stroke-linejoin="round"/>`;
    body += lettering('MODERN UI', 160, 88, 34, pale);
    body += lettering('WELCOME', 90, 236, 106, pale, 0.95);
    body += `<path d="M91 400H511" stroke="${mint}" stroke-width="8" stroke-linecap="round"/><rect x="84" y="492" width="895" height="298" rx="32" fill="#1B2D45" stroke="#2D435E" stroke-width="2"/><rect x="116" y="530" width="260" height="30" rx="15" fill="${muted}" opacity="0.5"/><rect x="116" y="603" width="804" height="12" rx="6" fill="#344A62"/><rect x="116" y="603" width="526" height="12" rx="6" fill="${mint}"/><circle cx="642" cy="609" r="19" fill="${pale}"/><rect x="116" y="680" width="78" height="43" rx="21.5" fill="${mint}"/><circle cx="171" cy="701.5" r="15" fill="#12243A"/>`;
    body += `<rect x="1040" y="258" width="386" height="533" rx="40" fill="#1A2C42" stroke="#324B61" stroke-width="2"/><rect x="1086" y="307" width="295" height="186" rx="30" fill="#213E51"/><circle cx="1233" cy="400" r="58" fill="none" stroke="${mint}" stroke-width="8"/><path d="M1208 400L1227 419L1259 382" stroke="${pale}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="1086" y="544" width="218" height="22" rx="11" fill="${pale}" opacity="0.85"/><rect x="1086" y="589" width="270" height="14" rx="7" fill="${muted}" opacity="0.6"/><rect x="1086" y="691" width="295" height="52" rx="18" fill="${mint}"/>`;
  } else {
    const big = recipe.name === 'MUIP Big';
    body += `<rect x="64" y="112" width="176" height="176" rx="${big ? 56 : 40}" fill="${mint}"/><path d="M105 238V162L152 208L199 162V238" stroke="#12243A" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
    body += lettering('MUIP', 292, 118, 114, pale, 1.1);
    body += lettering('MODERN UI', 301, 270, 27, muted, 1.2);
    if (big) body += `<circle cx="856" cy="93" r="22" fill="${mint}"/><path d="M829 314H889M859 284V344" stroke="${mint}" stroke-width="6" stroke-linecap="round"/>`;
    else body += `<path d="M812 130H867M812 161H845M812 192H867" stroke="${mint}" stroke-width="8" stroke-linecap="round"/>`;
  }
  return {
    svg: svg(w, h, `<svg width="${w}" height="${h}" viewBox="0 0 ${worldW} ${worldH}" preserveAspectRatio="xMidYMid meet">${body}</svg>`),
    border: null,
    notes: ['presentation-only: original dark navy and mint demonstration artwork.', 'Vector path lettering has no font dependency; no source pixels or branded third-party logos are reused.', 'The original filename is a role mapping, not a claim of native prefab drop-in compatibility.'],
  };
}

/** Render an original primitive using inspected dimensions, never filename-implied dimensions. */
export function renderPrimitiveSvg(relativePath, input) {
  const options = dimensions(input);
  const recipe = identify(relativePath);
  if (recipe.category === 'border') return borderRecipe(recipe, options);
  if (recipe.category === 'shadow') return shadowRecipe(recipe, options);
  return demoRecipe(recipe, options);
}
