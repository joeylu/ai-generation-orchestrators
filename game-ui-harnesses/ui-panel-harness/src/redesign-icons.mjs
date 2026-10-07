/**
 * Independently authored, tintable geometric icons for the modern-core family.
 * The source catalog's names identify semantic roles only; no source pixels or
 * third-party SVG paths are used. All artwork shares a 24-unit optical grid.
 */
const p = (d, extra = '') => `<path d="${d}"${extra}/>`;
const circle = (x, y, r, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}"${extra}/>`;
const dot = (x, y, r = 1) => circle(x, y, r, ' fill="currentColor" stroke="none"');
const solid = (d) => p(d, ' fill="currentColor" fill-rule="evenodd" stroke="none"');
const body = (d, filled, holes = '') => filled ? solid(`${d} ${holes}`) : p(`${d} ${holes}`);
const boxPath = (x, y, w, h, r = 2) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
const box = (x, y, w, h, r = 2, filled = false, holes = '') => body(boxPath(x, y, w, h, r), filled, holes);
const diskPath = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
const disk = (x, y, r, filled = false, holes = '') => body(diskPath(x, y, r), filled, holes);
const heart = 'M12 20C10 18.4 3 14 3 8.8C3 4.7 8.2 2.7 12 7C15.8 2.7 21 4.7 21 8.8C21 14 14 18.4 12 20Z';
const star = 'M12 2.7L14.9 8.6L21.4 9.5L16.7 14.1L17.8 20.6L12 17.5L6.2 20.6L7.3 14.1L2.6 9.5L9.1 8.6Z';
const cloud = 'M6.5 18.5C1.3 18.5 1.5 10.8 6.6 10.3C8 4.2 16.6 4.2 18 10.3C23 10.8 23 18.5 18 18.5Z';
const bell = 'M5 16.5L6.5 14V9.5C6.5 6.1 8.8 4 12 4C15.2 4 17.5 6.1 17.5 9.5V14L19 16.5Z';
const shield = 'M12 3L20 6V11C20 15.5 16.8 19 12 21C7.2 19 4 15.5 4 11V6Z';
const bag = 'M5 8H19L20 20H4Z';
const mail = boxPath(3, 5, 18, 14, 2.5);
const message = 'M6 4H18Q21 4 21 7V15Q21 18 18 18H10L5 21V18Q3 18 3 15V7Q3 4 6 4Z';
const photo = boxPath(3, 4, 18, 16, 2.5);
const pin = 'M12 21C10 18.5 5 14 5 9.5C5 0.8 19 0.8 19 9.5C19 14 14 18.5 12 21Z';
const doc = 'M5 3H14L19 8V21H5Z';
const gear = 'M10 2.8H14L14.7 5.5L17 6.8L19.7 6L21.7 9.4L19.7 11.4V13.8L21.7 15.7L19.7 19.1L17 18.3L14.7 19.6L14 22H10L9.3 19.6L7 18.3L4.3 19.1L2.3 15.7L4.3 13.8V11.4L2.3 9.4L4.3 6L7 6.8L9.3 5.5Z';
const phone = boxPath(7, 2.5, 10, 19, 2.5);
const camera = 'M8 6L9.5 3.5H14.5L16 6H19Q21 6 21 8V18Q21 20 19 20H5Q3 20 3 18V8Q3 6 5 6Z';
const lockTop = () => p('M7 10V7.5C7 0.8 17 0.8 17 7.5V10');
const lockBottom = (f) => box(5, 10, 14, 11, 2.5, f, f ? 'M11 14H13V18H11Z' : '') + (f ? '' : p('M12 14V17'));
const question = (f) => disk(12, 12, 9, f, f ? 'M9.2 8.1C9.2 4.8 15.5 4.7 15.5 8.7C15.5 11 13 11.1 13 13H11C11 10 13.5 10 13.5 8.7C13.5 7.2 11.2 7.1 11.2 8.3Z M11 15H13V17H11Z' : '') + (f ? '' : p('M9.5 8.7C9.5 5.4 15 5.4 15 8.7C15 11 12 10.7 12 13') + dot(12, 16));

// Filled variants use true transparent counter-shapes, never a painted background.
const glyphs = {
  card: (f) => box(3, 5, 18, 14, 2.5, f, f ? 'M3 9H21V11H3Z M6 14H11V16H6Z' : '') + (f ? '' : p('M3 10H21M6 15H10')),
  coin: (f) => disk(12, 12, 9, f, 'M12 7L16 12L12 17L8 12Z'),
  money: (f) => box(2.5, 5.5, 19, 13, 2, f, f ? diskPath(12, 12, 3) + 'M5 10H7V14H5Z M17 10H19V14H17Z' : '') + (f ? '' : circle(12, 12, 3) + p('M6 10V14M18 10V14')),
  pie: (f) => body('M10 3V14H21A10 10 0 1 1 10 3Z', f) + body('M14 2.5A8 8 0 0 1 21.5 10H14Z', f),
  bag: (f) => body(bag, f) + p('M8 8V6C8 0.7 16 0.7 16 6V8'),
  bell: (f) => body(bell, f) + p('M9 20C10.4 21.3 13.6 21.3 15 20M12 2.5V4'),
  eye: () => p('M2 12C6.5 3.5 17.5 3.5 22 12C17.5 20.5 6.5 20.5 2 12Z') + circle(12, 12, 3),
  eyeOff: () => p('M3 3L21 21M8.5 5.9C13.5 4 18.7 6.2 22 12L18.9 15.8M15.5 18.1C10.5 20 5.3 17.8 2 12L5.1 8.2M10 10A3 3 0 0 0 14 14'),
  heart: (f) => body(heart, f),
  star: (f) => body(star, f),
  discord: (f) => body('M6 5L9 4L10 6H14L15 4L18 5C20 8 21 12 21 17L17 19L15.5 17.2C13.2 18 10.8 18 8.5 17.2L7 19L3 17C3 12 4 8 6 5Z', f, f ? diskPath(8.5, 11.5, 1.3) + diskPath(15.5, 11.5, 1.3) + 'M8 14Q12 16 16 14L15.7 15.8Q12 17.5 8.3 15.8Z' : '') + (f ? '' : dot(8.5, 11.5, 1.2) + dot(15.5, 11.5, 1.2) + p('M8 15Q12 17 16 15')),
  email: (f) => body(mail, f, f ? 'M5 7L12 12L19 7V9.5L12 14.5L5 9.5Z' : '') + (f ? '' : p('M3.5 6L12 12.5L20.5 6')),
  emailOpen: () => p('M4 10L12 3L20 10V20H4Z M4 10L12 15.5L20 10 M4 20L9 14M20 20L15 14'),
  facebook: (f) => f ? solid('M15.8 2.5H12.7C8.9 2.5 8 4.8 8 8V10H5V14H8V21.5H12V14H15.2L16 10H12V8C12 6.8 12.5 6.5 13.5 6.5H15.8Z') : p('M15.5 3H13C9.5 3 9 5 9 8V21M6 11H15M13 21V14'),
  github: (f) => body('M6.2 7L5.8 2.8L10 5Q12 4.5 14 5L18.2 2.8L17.8 7Q21 9 20 13C19.5 16 17 17 14 17V21H10V17C7 17 4.5 16 4 13Q3 9 6.2 7Z', f, f ? diskPath(8.8, 11.5, 1) + diskPath(15.2, 11.5, 1) : '') + (f ? '' : dot(8.8, 11.5) + dot(15.2, 11.5)) + p('M10 19H7Q4.5 19 3 16'),
  instagram: (f) => box(3, 3, 18, 18, 5, f, f ? diskPath(12, 12, 4.4) + diskPath(17.5, 6.5, 1.2) : '') + (f ? '' : circle(12, 12, 4) + dot(17.5, 6.5, 1.1)),
  message: (f) => body(message, f, f ? 'M7 8H17V10H7Z M7 12H14V14H7Z' : '') + (f ? '' : p('M7 9H17M7 13H14')),
  messageEmpty: () => p(message),
  reddit: (f) => body('M5 9C1 8 1 14 4 14C4 22 20 22 20 14C23 14 23 8 19 9C15 6 9 6 5 9Z', f, f ? diskPath(8, 13, 1.2) + diskPath(16, 13, 1.2) + 'M8 16Q12 19 16 16L15.2 15.2Q12 17.2 8.8 15.2Z' : '') + p('M12 7L13.2 3L17.5 4') + circle(19, 4.5, 1.5) + (f ? '' : dot(8, 13) + dot(16, 13) + p('M8 16Q12 19 16 16')),
  share: (f) => p('M6 11L17 5M6 13L17 19') + disk(5, 12, 2.5, f) + disk(18, 4.5, 2.5, f) + disk(18, 19.5, 2.5, f),
  steam: (f) => body('M4 15L7 14L13 9L14 5L19 3L22 6L21 11L17 13L11 18L10 21H6L3 18Z', f, f ? diskPath(17.5, 7.5, 2.4) + diskPath(7.5, 17, 1.6) : '') + (f ? '' : circle(17.5, 7.5, 2.4) + circle(7.5, 17, 1.6)),
  twitter: (f) => body('M21 5L18.8 7.2C18.7 16.2 13.5 21.4 4 19.2C7.4 18.8 8.9 17.5 9.5 16C5.6 15.8 3 12.1 3.6 7.1C6.2 10.1 9 11 11.5 11C10 6.2 14.2 3.5 17.7 5.7Z', f),
  twitterX: () => solid('M3 3H8L21 21H16Z M17.5 3H20.5L6.5 21H3.5Z'),
  user: (f) => disk(12, 7, 4, f) + body('M4 21V18C4 10.8 20 10.8 20 18V21Z', f),
  youtube: (f) => box(2.5, 5, 19, 14, 4, f, 'M10 9L16 12L10 15Z'),
  clock: () => circle(12, 12, 9) + p('M12 6V12L16 14'),
  crop: (f) => f ? solid('M6 2H8V16H22V18H6Z M2 6H18V22H16V8H2Z') : p('M7 3V17H21M3 7H17V21'),
  headphones: (f) => p('M4 15V11C4 0.3 20 0.3 20 11V15') + box(3, 12, 5, 8, 2, f) + box(16, 12, 5, 8, 2, f),
  bulb: (f) => body('M8 16V14.5C1 8 6 2 12 2C18 2 23 8 16 14.5V16Z', f, f ? 'M9 8L12 11L15 8L16 9L13 12V15H11V12L8 9Z' : '') + (f ? '' : p('M9 8L12 11L15 8M12 11V16')) + p('M8 19H16M10 22H14'),
  monitor: (f) => box(2.5, 4, 19, 13, 2, f, f ? boxPath(5, 6.5, 14, 8, 0.5) : '') + p('M12 17V21M8 21H16'),
  phone: (f) => body(phone, f, f ? boxPath(9, 6, 6, 11, 0.6) : '') + (f ? '' : p('M10 5H14M11 19H13')),
  power: () => p('M12 2V11M6 5C-2 12 4 22 12 22C20 22 26 12 18 5'),
  speaker: (f) => body('M3 9H7L12 5V19L7 15H3Z', f) + p('M16 8C19 10 19 14 16 16M19 5C24 9 24 15 19 19'),
  book: (f) => body('M12 6C9 3.5 5 3.5 2.5 5V20C5 18.5 9 18.5 12 21C15 18.5 19 18.5 21.5 20V5C19 3.5 15 3.5 12 6Z', f, f ? 'M11 6H13V19H11Z M5 8H8V10H5Z M16 8H19V10H16Z' : '') + (f ? '' : p('M12 6V21M5 8H8M16 8H19')),
  docs: (f) => p('M6 7H3V21H16V18') + box(7, 3, 14, 14, 2, f, f ? 'M10 7H18V9H10Z M10 11H15V13H10Z' : '') + (f ? '' : p('M10 7H18M10 11H15')),
  document: (f) => body(doc, f, f ? 'M13 3V9H19Z M8 12H16V14H8Z M8 16H14V18H8Z' : '') + (f ? '' : p('M14 3V8H19M8 12H16M8 16H14')),
  folder: (f) => body('M3 5H10L12 8H21V19Q21 21 19 21H5Q3 21 3 19Z', f, f ? 'M6 11H18V13H6Z' : '') + (f ? '' : p('M3 9H21')),
  globe: (f) => disk(12, 10, 7.5, f, f ? 'M11 3H13V17H11Z M5 9H19V11H5Z' : '') + (f ? '' : p('M5 10H19M12 2.5C6.8 6 6.8 14 12 17.5C17.2 14 17.2 6 12 2.5')) + p('M12 18V21M8 21H16'),
  location: (f) => body(pin, f, diskPath(12, 9.5, 2.5)),
  map: (f) => body('M3 5L9 3L15 5L21 3V19L15 21L9 19L3 21Z', f, f ? 'M8 4H10V19H8Z M14 5H16V20H14Z' : '') + (f ? '' : p('M9 3V19M15 5V21')),
  world: (f) => disk(12, 12, 9, f, f ? 'M6 6L10 5L10 8L13 9L12 12L9 12L8 16L5 14Z M16 13L19 11L20 15L17 18L15 17Z' : '') + (f ? '' : p('M6 6L10 5L10 8L13 9L12 12H9L8 16L4 14M21 11L16 13L15 17L17 19')),
  camera: (f) => body(camera, f, diskPath(12, 12.5, 3.5)),
  microphone: (f) => box(8, 2.5, 8, 12, 4, f, f ? 'M11 5H13V9H11Z' : '') + p('M5 11V12C5 21.3 19 21.3 19 12V11M12 19V22M9 22H15'),
  music: (f) => body('M9 4L20 2.5V6.5L9 8Z', f) + p('M9 7V18M20 6V16') + body('M9 18C9 22.5 2 22.5 2 19C2 16 7 15.5 9 18Z', f) + body('M20 16C20 20.5 13 20.5 13 17C13 14 18 13.5 20 16Z', f),
  pause: () => box(6, 4, 4, 16, 1, true) + box(14, 4, 4, 16, 1, true),
  photo: (f) => body(photo, f, f ? diskPath(8, 8.5, 1.8) + 'M5 17L10 12L13 15L16 11L19 16V18H5Z' : '') + (f ? '' : dot(8, 8.5, 1.5) + p('M4 18L10 12L13 15L16 11L21 17')),
  play: (f) => body('M7 3.5L21 12L7 20.5Z', f),
  video: (f) => box(2.5, 5.5, 13, 13, 2.5, f) + body('M16 9L21.5 6V18L16 15Z', f),
  add: () => p('M12 4V20M4 12H20'),
  down: () => p('M12 3V21M5 14L12 21L19 14'),
  left: () => p('M21 12H3M10 5L3 12L10 19'),
  right: () => p('M3 12H21M14 5L21 12L14 19'),
  up: () => p('M12 21V3M5 10L12 3L19 10'),
  chevronDown: () => p('M5 8L12 15L19 8'),
  chevronLeft: () => p('M15 5L8 12L15 19'),
  chevronRight: () => p('M8 5L15 12L8 19'),
  chevronUp: () => p('M5 16L12 9L19 16'),
  check: () => p('M4 12L9 17L20 6'),
  close: () => p('M5 5L19 19M19 5L5 19'),
  help: question,
  home: (f) => body('M3 10L12 3L21 10V21H15V14H9V21H3Z', f),
  refresh: (f) => p('M20 9C17 0 5 1.5 3 10M4 15C7 24 19 22.5 21 14') + (f ? solid('M16 9L21 4L22 10Z M8 15L3 20L2 14Z') : p('M16 9H21V4M8 15H3V20')),
  search: (f) => disk(10, 10, 7, f, f ? diskPath(10, 10, 4.3) : '') + p('M15.5 15.5L21 21'),
  subtract: () => p('M4 12H20'),
  swap: (f) => p('M3 7H21M21 17H3') + (f ? solid('M16 2L22 7L16 12Z M8 12L2 17L8 22Z') : p('M16 2L21 7L16 12M8 12L3 17L8 22')),
  warning: (f) => body('M12 2.8L22 21H2Z', f, f ? 'M11 9H13V14H11Z M11 16H13V18H11Z' : '') + (f ? '' : p('M12 9V14') + dot(12, 17)),
  expand: () => p('M3 9V3H9M15 3H21V9M21 15V21H15M9 21H3V15'),
  separator: () => p('M3 12H7M11 12H13M17 12H21'),
  heartPop: () => p('M3 3L5.2 5.2M21 3L18.8 5.2M2 11H4M20 11H22M5 19L6.5 17.5M19 19L17.5 17.5'),
  lockBottom,
  lockTop,
  hourglass: () => p('M5 3H19M5 21H19M6 3C6 9 8 9 12 12C8 15 6 15 6 21M18 3C18 9 16 9 12 12C16 15 18 15 18 21'),
  sand: () => solid('M8 6H16C15.3 8.8 13.3 9.2 12 10.5C10.7 9.2 8.7 8.8 8 6Z M12 14L16.5 19H7.5Z') + dot(12, 12, 0.65),
  medal: (f) => body('M6 3H10L12 7L14 3H18L15 10H9Z', f) + disk(12, 15, 6.5, f, f ? 'M12 11L13.2 13.6L16 14L14 16L14.5 18.8L12 17.5L9.5 18.8L10 16L8 14L10.8 13.6Z' : '') + (f ? '' : p('M12 12V18M10 13L12 12')),
  trophy: (f) => body('M6 3H18V8C18 16 6 16 6 8Z', f) + p('M6 5H2V8C2 11 4 12 7 12M18 5H22V8C22 11 20 12 17 12M12 14V20M8 21H16'),
  lock: (f) => lockTop() + lockBottom(f),
  settings: (f) => body(gear, f, diskPath(12, 12.5, 3.5)),
  shield: (f) => body(shield, f, f ? 'M7 11L10.5 14.5L17 8L18.4 9.4L10.5 17.3L5.6 12.4Z' : '') + (f ? '' : p('M7 12L10.5 15.5L17 9')),
  trash: (f) => box(6, 7, 12, 14, 2, f, f ? 'M9 10H11V18H9Z M13 10H15V18H13Z' : '') + p('M3 6H21M9 6V3H15V6') + (f ? '' : p('M10 10V18M14 10V18')),
  button: (f) => box(2.5, 6, 19, 12, 4, f, f ? boxPath(8, 11, 8, 2, 1) : '') + (f ? '' : p('M8 12H16')),
  contextMenu: () => box(5, 3, 16, 18, 2) + p('M12 7H17M12 12H17M12 17H17') + dot(8, 7, 0.65) + dot(8, 12, 0.65) + dot(8, 17, 0.65),
  dropdown: (f) => box(2.5, 6, 19, 12, 2.5, f, f ? 'M5 11H10V13H5Z M13 10L16 13L19 10V13L16 16L13 13Z' : '') + (f ? '' : p('M6 12H10M14 10.5L16.5 13L19 10.5')),
  input: () => box(2.5, 6, 19, 12, 2) + p('M7 10V14M7 12H11M15 3V21M13 3H17M13 21H17'),
  list: () => box(2.5, 3, 19, 18, 2) + p('M9 7H18M9 12H18M9 17H18') + dot(6, 7, 0.65) + dot(6, 12, 0.65) + dot(6, 17, 0.65),
  modal: () => box(2.5, 3, 19, 18, 2) + box(5.5, 8, 13, 10, 1.5) + p('M9 12H15M10 15H14') + dot(6, 5.5, 0.55),
  movable: () => box(2.5, 3, 19, 18, 2) + p('M3 7H21M12 10V18M8 14H16M10 12L12 10L14 12M10 16L12 18L14 16M10 12L8 14L10 16M14 12L16 14L14 16'),
  progress: (f) => box(2.5, 8, 19, 8, 4, f, f ? boxPath(14, 10, 5.5, 4, 2) : '') + (f ? '' : p('M7 11V13M10 11V13M13 11V13')),
  slider: (f) => p('M3 12H7M13 12H21') + disk(10, 12, 3.5, f),
  switch: (f) => box(2.5, 6, 19, 12, 6, f, f ? diskPath(16, 12, 3.5) : '') + (f ? '' : circle(8, 12, 3.5)),
  toggle: (f) => box(3, 3, 18, 18, 4, f, f ? 'M6 12L10 16L18 8L16.5 6.5L10 13L7.5 10.5Z' : '') + (f ? '' : p('M7 12L10 15L17 8')),
  windows: () => p('M7 17H3V3H17V7') + box(7, 7, 14, 14, 2) + p('M7 11H21'),
  cloud: (f) => body(cloud, f),
  sun: (f) => disk(12, 12, 4.5, f) + p('M12 2V4M12 20V22M2 12H4M20 12H22M4.9 4.9L6.3 6.3M17.7 17.7L19.1 19.1M4.9 19.1L6.3 17.7M17.7 6.3L19.1 4.9'),
  download: (f) => body(cloud, f, f ? 'M11 10H13V14.5L15 12.5L16.4 14L12 18.4L7.6 14L9 12.5L11 14.5Z' : '') + (f ? '' : p('M12 10V18M8.5 14.5L12 18L15.5 14.5')),
  upload: (f) => body(cloud, f, f ? 'M11 18H13V13.5L15 15.5L16.4 14L12 9.6L7.6 14L9 15.5L11 13.5Z' : '') + (f ? '' : p('M12 18V10M8.5 13.5L12 10L15.5 13.5')),
};

const registry = new Map();
function add(folder, name, glyph, filled = false) {
  const key = `Icon/${folder}/${name}.png`;
  if (registry.has(key) || !Object.hasOwn(glyphs, glyph)) throw new Error(`Invalid built-in icon: ${key}`);
  registry.set(key, Object.freeze({ glyph, filled }));
}
function pair(folder, name, glyph, filledName = `${name} Filled`) {
  add(folder, name, glyph);
  add(folder, filledName, glyph, true);
}

for (const [name, glyph] of [['Credit Card', 'card'], ['Diamond Coin', 'coin'], ['Money', 'money'], ['Shopping Bag', 'bag']]) pair('Business & Commerce', name, glyph);
pair('Business & Commerce', 'Pie Chart', 'pie', 'Pie Chart (Filled)');
for (const [name, glyph] of [['Bell', 'bell'], ['Heart', 'heart'], ['Star', 'star']]) pair('Common', name, glyph);
add('Common', 'Eye', 'eye');
add('Common', 'Eye Off', 'eyeOff');
for (const [name, glyph] of [['Discord', 'discord'], ['Email', 'email'], ['Facebook', 'facebook'], ['Instagram', 'instagram'], ['Message', 'message'], ['Reddit', 'reddit'], ['Share', 'share'], ['Steam', 'steam'], ['Twitter', 'twitter'], ['User', 'user'], ['YouTube', 'youtube']]) pair('Communication & Social', name, glyph);
pair('Communication & Social', 'Github', 'github', 'Github (Filled)');
add('Communication & Social', 'Email 2', 'emailOpen');
add('Communication & Social', 'Message Empty', 'messageEmpty');
add('Communication & Social', 'Twitter X', 'twitterX');
add('Date & Time', 'Clock', 'clock');
pair('Design', 'Crop', 'crop');
for (const [name, glyph] of [['Headphones', 'headphones'], ['Lightbulb', 'bulb'], ['Monitor', 'monitor'], ['Phone', 'phone'], ['Speaker', 'speaker']]) pair('Device', name, glyph);
add('Device', 'Power', 'power');
for (const [name, glyph] of [['Book', 'book'], ['Docs', 'docs'], ['Document', 'document'], ['Folder', 'folder']]) pair('Document', name, glyph);
for (const [name, glyph] of [['Globe', 'globe'], ['Location Mark', 'location'], ['Map', 'map'], ['World', 'world']]) pair('Map', name, glyph);
for (const [name, glyph] of [['Camera', 'camera'], ['Microphone', 'microphone'], ['Music', 'music'], ['Photo', 'photo'], ['Play', 'play'], ['Video', 'video']]) pair('Media', name, glyph);
add('Media', 'Pause', 'pause');
for (const [name, glyph] of [['Add', 'add'], ['Arrow Down', 'down'], ['Arrow Left', 'left'], ['Arrow Right', 'right'], ['Arrow Up', 'up'], ['Arrow Simple Down', 'chevronDown'], ['Arrow Simple Left', 'chevronLeft'], ['Arrow Simple Right', 'chevronRight'], ['Arrow Simple Up', 'chevronUp'], ['Check', 'check'], ['Close', 'close'], ['Subtract', 'subtract']]) add('Navigation', name, glyph);
for (const [name, glyph] of [['Help', 'help'], ['Home', 'home'], ['Refresh', 'refresh'], ['Search', 'search'], ['Warning', 'warning']]) pair('Navigation', name, glyph);
pair('Navigation', 'Swap', 'swap', 'Swap (Filled)');
add('Others', 'Expand', 'expand');
add('Others', 'Panel Seperator', 'separator');
for (const [name, glyph] of [['Heart Pop', 'heartPop'], ['Lock Bottom', 'lockBottom'], ['Lock Top', 'lockTop'], ['Sand Clock', 'hourglass'], ['Sand Clock Sand', 'sand']]) add('Others/Animation Icon Stuff', name, glyph);
pair('Reward', 'Medal', 'medal');
pair('Reward', 'Trophy', 'trophy');
for (const [name, glyph] of [['Lock', 'lock'], ['Settings', 'settings'], ['Shield', 'shield'], ['Trash', 'trash']]) pair('System', name, glyph);
for (const [name, glyph] of [['Button', 'button'], ['Dropdown', 'dropdown'], ['Progress Bar', 'progress'], ['Slider', 'slider'], ['Switch', 'switch'], ['Toggle', 'toggle']]) pair('UI Elements', name, glyph, `${name} (Filled)`);
for (const [name, glyph] of [['Context Menu', 'contextMenu'], ['Input Filed', 'input'], ['List View', 'list'], ['Modal Window', 'modal'], ['Movable Window', 'movable'], ['Window Manager', 'windows']]) add('UI Elements', name, glyph);
pair('Weather', 'Cloud', 'cloud');
pair('Weather', 'Sun', 'sun');
pair('Web & Cloud', 'Cloud Download', 'download');
pair('Web & Cloud', 'Cloud Upload', 'upload');

export function supportedIconPaths() {
  return [...registry.keys()].sort();
}

function iconError(code, message) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** Render one exact catalog role. Unsupported roles fail rather than substitute. */
export function renderIconSvg(relativePath, options = {}) {
  if (typeof relativePath !== 'string') throw iconError('UNKNOWN_ICON', 'expected an exact catalog path');
  const entry = registry.get(relativePath.replaceAll('\\', '/'));
  if (!entry) throw iconError('UNKNOWN_ICON', 'path is not in the icon registry');
  if (!options || typeof options !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(options))) throw iconError('INVALID_ICON_OPTIONS', 'expected plain options');
  for (const key of Reflect.ownKeys(options)) {
    if (!['width', 'height', 'color'].includes(key)) throw iconError('INVALID_ICON_OPTIONS', 'unknown option');
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw iconError('INVALID_ICON_OPTIONS', 'options must be plain data');
  }
  const { width = 128, height = 128, color = '#F1F5FC' } = options;
  for (const dimension of [width, height]) {
    if (!Number.isSafeInteger(dimension) || dimension < 8 || dimension > 4096) throw iconError('INVALID_ICON_SIZE', 'dimensions must be integers from 8 through 4096');
  }
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw iconError('INVALID_ICON_COLOR', 'expected a six-digit hex color');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" color="${color.toUpperCase()}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyphs[entry.glyph](entry.filled)}</svg>`;
}
