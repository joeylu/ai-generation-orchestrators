// Filename semantics are retrieval hints, not a review of the image's pixels.
const ALIASES = {
  volume: ['音量', '声音', '音频'], speaker: ['扬声器', '喇叭', '音量', '声音', '音频'],
  settings: ['设置', '配置', '偏好'], close: ['关闭', '取消'], check: ['确认', '完成', '勾选'],
  arrow: ['箭头', '导航'], up: ['向上'], down: ['向下'], left: ['向左', '返回'], right: ['向右', '前进'],
  play: ['播放', '开始'], pause: ['暂停'], stop: ['停止'], user: ['用户', '账户', '角色'],
  search: ['搜索', '查找'], music: ['音乐', '背景音乐', '音频'], microphone: ['麦克风', '语音', '音频'],
  headphones: ['耳机', '音频'], video: ['视频'], photo: ['照片', '图片'], camera: ['相机', '拍照'],
  lock: ['锁定', '解锁', '安全'], shield: ['盾牌', '保护', '安全'], trash: ['删除', '回收站'],
  home: ['主页', '首页'], help: ['帮助'], warning: ['警告', '提示'], add: ['增加', '添加'],
  subtract: ['减少', '减去'], refresh: ['刷新', '重置'], swap: ['交换', '切换'],
  eye: ['显示', '可见'], off: ['关闭', '禁用'], heart: ['爱心', '收藏', '生命'],
  star: ['星星', '收藏', '评分'], bell: ['通知', '铃铛'], power: ['电源', '开关'],
  button: ['按钮'], slider: ['滑条', '滑块', '数值调节'], switch: ['开关', '切换'], toggle: ['开关', '切换'],
  dropdown: ['下拉框', '选择'], input: ['输入框', '文本输入'], progress: ['进度'],
  window: ['窗口', '面板'], panel: ['面板'], menu: ['菜单'], list: ['列表'],
  email: ['邮件'], message: ['消息', '聊天'], share: ['分享'], cloud: ['云'],
  upload: ['上传'], download: ['下载'], folder: ['文件夹'], document: ['文档'], docs: ['文档'],
  book: ['书籍'], clock: ['时钟', '时间'], money: ['金钱', '货币'], coin: ['货币', '金币'],
  trophy: ['奖杯', '奖励'], medal: ['勋章', '奖励'], globe: ['地球', '全球'],
  map: ['地图'], location: ['位置', '定位'], sun: ['太阳', '亮度'], monitor: ['显示器', '屏幕'],
  phone: ['手机'], lightbulb: ['灯泡', '灯光'], rounded: ['圆角', '边框'], radial: ['圆形', '边框'],
  shadow: ['阴影'], horizontal: ['水平'], vertical: ['垂直'], flat: ['平面'],
};

function slug(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'unnamed';
}

/** Classify a portable, slash-separated path relative to Textures (or with Textures/ prefix). */
export function classifyTexture(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.length || relativePath.length > 512
      || !relativePath.isWellFormed() || /[\\:\u0000-\u001f\u007f-\u009f]/u.test(relativePath)
      || relativePath.startsWith('/') || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('texture path must be a safe relative forward-slash path of at most 512 characters');
  }
  const parts = relativePath.split('/');
  if (parts[0].toLowerCase() === 'textures') parts.shift();
  const name = parts.at(-1).replace(/\.[^.]+$/, '');
  const category = ({ border: 'border', icon: 'icon', shadow: 'shadow', demo: 'demo' })[parts[0]?.toLowerCase()] ?? 'other';
  const filled = /(?:\s|^)\(?filled\)?(?:\s|$)/i.test(name);
  const outline = /(?:\s|^)\(?outline\)?(?:\s|$)/i.test(name);
  const part = category === 'icon' && parts.some((item) => /^animation icon stuff$/i.test(item));
  const base = name.replace(/(?:\s|^)\(?filled\)?(?=\s|$)/ig, ' ').replace(/\s+/g, ' ').trim();
  let family = `${category}.${part ? 'part.' : ''}${slug(base)}`;
  let nominalSize = null;
  let weight = null;
  if (category === 'border') {
    const match = /^(Rounded|Radial) (Filled|Outline) ([1-9]\d*)px(?: - ([1-9]\d*)x)?$/i.exec(name);
    if (match && Number.isSafeInteger(Number(match[3])) && (match[4] === undefined || Number.isSafeInteger(Number(match[4])))) {
      family = `border.${match[1].toLowerCase()}`;
      nominalSize = Number(match[3]);
      weight = match[4] === undefined ? null : Number(match[4]);
    }
  }
  const style = part ? 'part' : filled ? 'filled' : outline ? 'outline' : 'default';
  const words = base.toLowerCase().match(/[a-z]+/g) ?? [];
  const tags = new Set([category, style, ...words]);
  for (const word of words) for (const alias of ALIASES[word] ?? []) tags.add(alias);
  if (category === 'icon') tags.add('图标');
  if (category === 'border') tags.add('边框');
  if (part) { tags.add('animation-part'); tags.add('动画拆件'); }
  if (category === 'demo') { tags.add('presentation-only'); tags.add('演示素材'); }
  return { category, family, variant: { style, nominalSize, weight }, tags: [...tags].sort(), semanticEvidence: 'path-rules', review: 'NOT_RUN' };
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const IMPORTER_FIELDS = new Set(['spriteMode', 'spritePixelsToUnits', 'spritePivot', 'spriteBorder', 'alphaIsTransparency']);

/** A conservative Unity .meta field reader, deliberately not a general YAML parser. */
export function parseUnityTextureMeta(text, { width, height } = {}) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new TypeError('meta text must be a string of at most 2 MiB');
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError('texture dimensions must be positive safe integers');
  }
  const issues = [];
  const values = new Map();
  const addIssue = (issue) => { if (!issues.includes(issue)) issues.push(issue); };
  const capture = (key, value) => {
    if (values.has(key)) { values.set(key, null); addIssue(`duplicate:${key}`); }
    else values.set(key, value.replace(/\s+#.*$/, '').trim());
  };
  let inImporter = false;
  let importers = 0;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\s*\t/.test(line)) { addIssue('unsupported:tab-indentation'); continue; }
    if (/^\S/.test(line)) {
      inImporter = false;
      const root = /^([A-Za-z][A-Za-z0-9_]*):(?:\s*(.*))$/.exec(line);
      if (!root) continue;
      if (root[1] === 'guid') capture('guid', root[2]);
      if (root[1] === 'TextureImporter') {
        importers += 1;
        if (root[2].replace(/\s*#.*$/, '').trim() === '') inImporter = true;
        else addIssue('unsupported:TextureImporter');
      }
      continue;
    }
    if (inImporter) {
      const field = /^ {2}([A-Za-z][A-Za-z0-9_]*):(?:\s*(.*))$/.exec(line);
      if (field && IMPORTER_FIELDS.has(field[1])) capture(field[1], field[2]);
    }
  }
  if (importers === 0) addIssue('missing:TextureImporter');
  if (importers > 1) {
    addIssue('duplicate:TextureImporter');
    for (const key of IMPORTER_FIELDS) values.set(key, null);
  }
  function raw(key) {
    if (!values.has(key)) addIssue(`missing:${key}`);
    return values.get(key) ?? null;
  }
  function numeric(value, key) {
    if (value === null) return null;
    const result = NUMBER.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(result)) { addIssue(`invalid:${key}`); return null; }
    return result;
  }
  function vector(key, keys) {
    const value = raw(key);
    if (value === null) return null;
    const match = /^\{(.*)\}$/.exec(value);
    if (!match) { addIssue(`invalid:${key}`); return null; }
    const fields = new Map();
    for (const entry of match[1].split(',')) {
      const pair = /^\s*([a-z]+):\s*(.*?)\s*$/.exec(entry);
      if (!pair || !keys.includes(pair[1]) || fields.has(pair[1])) { addIssue(`invalid:${key}`); return null; }
      fields.set(pair[1], numeric(pair[2], key));
    }
    if (fields.size !== keys.length || [...fields.values()].some((item) => item === null)) { addIssue(`invalid:${key}`); return null; }
    return Object.fromEntries(keys.map((key) => [key, fields.get(key)]));
  }
  let guid = raw('guid');
  if (guid !== null && !/^[a-fA-F0-9]{32}$/.test(guid)) { addIssue('invalid:guid'); guid = null; }
  let spriteMode = numeric(raw('spriteMode'), 'spriteMode');
  if (spriteMode !== null && !Number.isSafeInteger(spriteMode)) { addIssue('invalid:spriteMode'); spriteMode = null; }
  const pixelsPerUnit = numeric(raw('spritePixelsToUnits'), 'spritePixelsToUnits');
  if (pixelsPerUnit !== null && pixelsPerUnit <= 0) addIssue('invalid:spritePixelsToUnits');
  const pivot = vector('spritePivot', ['x', 'y']);
  if (pivot && Object.values(pivot).some((item) => item < 0 || item > 1)) addIssue('out-of-range:spritePivot');
  const rawBorder = vector('spriteBorder', ['x', 'y', 'z', 'w']);
  const border = rawBorder ? { left: rawBorder.x, bottom: rawBorder.y, right: rawBorder.z, top: rawBorder.w } : null;
  const alpha = raw('alphaIsTransparency');
  const alphaIsTransparency = alpha === '1' ? true : alpha === '0' ? false : null;
  if (alpha !== null && alphaIsTransparency === null) addIssue('invalid:alphaIsTransparency');
  let nineSlice = 'unknown';
  const invalidBorder = border && (Object.values(border).some((item) => item < 0) || border.left + border.right >= width || border.bottom + border.top >= height);
  if (invalidBorder) addIssue('invalid:spriteBorder-geometry');
  if (spriteMode !== null && spriteMode !== 1) addIssue('not-single-sprite:spriteMode');
  if (spriteMode === 1 && border) {
    nineSlice = invalidBorder ? 'invalid' : Object.values(border).every((item) => item === 0) ? 'none' : 'valid';
  } else if (spriteMode === 1 && issues.includes('invalid:spriteBorder')) nineSlice = 'invalid';
  return { guid, spriteMode, pixelsPerUnit, pivot, border, alphaIsTransparency, nineSlice, issues };
}
