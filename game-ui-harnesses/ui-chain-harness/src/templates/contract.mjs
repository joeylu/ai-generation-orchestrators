import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';

export const root = new URL('../../', import.meta.url);
const schema = JSON.parse(await readFile(new URL('schemas/skin-template-set.schema.json', root), 'utf8'));
const checkStructure = new Ajv({ allErrors: true, strict: true }).compile(schema);
const escapePointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');

export class TemplateError extends Error {
  constructor(issues) {
    super('Template operation failed; see issues.');
    this.issues = issues;
  }
}
export function fail(path, code, message) { throw new TemplateError([{ path, code, message }]); }

export function validateTemplate(spec) {
  if (!checkStructure(spec)) return checkStructure.errors.map(error => ({
    path: `${error.instancePath}${error.keyword === 'required' ? `/${escapePointer(error.params.missingProperty)}` : error.keyword === 'additionalProperties' ? `/${escapePointer(error.params.additionalProperty)}` : ''}` || '/',
    code: `schema.${error.keyword}`, message: error.message,
  }));
  const issues = [];
  const error = (path, code, message) => issues.push({ path, code, message });
  const { width, height, outputScale } = spec.coordinates;
  const { minimumOuterMargin: margin, minimumBodyPadding: padding, minimumSlotGap: gap } = spec.constraints;
  if (width !== height) error('/coordinates/height', 'canvas.square', '模板板必须为 1:1 正方形。');
  if (width * outputScale > 4096 || height * outputScale > 4096) error('/coordinates/outputScale', 'canvas.limit', '最终 PNG 的每边不能超过 4096 像素。');
  if (margin < spec.reviewFont.size + 4) error('/constraints/minimumOuterMargin', 'review.header', '外边距必须至少为核对字号 + 4，留出页眉。');
  if (padding < spec.reviewFont.size + 4) error('/constraints/minimumBodyPadding', 'review.label', '主体留白必须至少为核对字号 + 4，留出编号。');
  const seen = { code: new Map(), assetId: new Map(), id: new Map(), filePrefix: new Map(), group: new Map() };
  function unique(kind, value, path) {
    if (seen[kind].has(value)) error(path, 'identity.duplicate', `与 ${seen[kind].get(value)} 重复。`);
    else seen[kind].set(value, path);
  }
  const assets = new Map();
  for (const [si, sheet] of spec.sheets.entries()) {
    const sp = `/sheets/${si}`;
    unique('id', sheet.id, `${sp}/id`);
    unique('filePrefix', sheet.filePrefix, `${sp}/filePrefix`);
    for (const [pi, part] of sheet.parts.entries()) {
      const p = `${sp}/parts/${pi}`;
      for (const key of ['code', 'assetId']) unique(key, part[key], `${p}/${key}`);
      assets.set(part.assetId, part);
      for (const [ci, consumer] of part.consumers.entries()) {
        if (!spec.consumerTypes.includes(consumer)) error(`${p}/consumers/${ci}`, 'reference.consumer', '使用方未在 consumerTypes 中声明。');
      }
      if (!Object.hasOwn(spec.palette, part.paint)) error(`${p}/paint`, 'reference.paint', '颜色键不在 palette 中。');
      const [x, y, w, h] = part.slotRect, [bx, by, bw, bh] = part.bodyRect;
      if (w <= 0 || h <= 0) error(`${p}/slotRect`, 'geometry.size', '槽位宽高必须大于零。');
      if (bw <= 0 || bh <= 0) error(`${p}/bodyRect`, 'geometry.size', '主体宽高必须大于零。');
      if (x < margin || y < margin || x+w > width-margin || y+h > height-margin) error(`${p}/slotRect`, 'geometry.bounds', '槽位越界或侵占板外边距。');
      if (Math.min(bx-x, by-y, x+w-bx-bw, y+h-by-bh) < padding) error(`${p}/bodyRect`, 'geometry.padding', '主体必须在槽位内，并满足四边留白。');
      for (const [oi, other] of sheet.parts.slice(0, pi).entries()) {
        const [ox, oy, ow, oh] = other.slotRect;
        const separation = Math.max(ox-x-w, x-ox-ow, oy-y-h, y-oy-oh);
        if (separation < gap) error(`${p}/slotRect`, 'geometry.overlap', `与 ${sp}/parts/${oi}/slotRect 重叠或间隔不足。`);
      }
      const primitive = part.primitive;
      if (primitive.type === 'roundRect' && primitive.radius > Math.min(bw,bh)/2) error(`${p}/primitive/radius`, 'geometry.radius', '圆角不能超过主体短边的一半。');
      if (['circle','ring'].includes(primitive.type) && bw !== bh) error(`${p}/bodyRect`, 'geometry.circle', 'circle/ring 的主体宽高必须相同。');
      if (part.strokeWidth >= Math.min(bw,bh)/2 || (primitive.type === 'ring' && part.strokeWidth <= 0)) error(`${p}/strokeWidth`, 'geometry.stroke', '描边必须小于短边的一半；ring 必须有正描边。');
      if (primitive.type === 'polygon') {
        if (part.strokeWidth !== 0) error(`${p}/strokeWidth`, 'geometry.polygonStroke', '当前 polygon 仅支持填充；strokeWidth 必须为 0。');
        let area = 0;
        for (const [i, [px, py]] of primitive.points.entries()) {
          if (px > bw || py > bh) error(`${p}/primitive/points/${i}`, 'geometry.point', '多边形点使用主体局部坐标，不能越界。');
          const [nx, ny] = primitive.points[(i+1)%primitive.points.length];
          area += px*ny - nx*py;
        }
        if (Math.abs(area) < 1) error(`${p}/primitive/points`, 'geometry.area', '多边形面积必须至少为半个逻辑像素。');
      }
      for (const key of ['sliceInsets', 'contentInsets']) {
        const inset = part[key];
        if (inset && (inset[0]+inset[2] >= bh || inset[1]+inset[3] >= bw)) error(`${p}/${key}`, 'geometry.insets', '边距顺序为 top/right/bottom/left，必须留出正的内部宽高。');
      }
    }
  }
  const grouped = new Set();
  const stateGeometry = part => [part.bodyRect.slice(2), part.bodyRect[0]-part.slotRect[0], part.bodyRect[1]-part.slotRect[1], part.primitive, part.stretch, part.sliceInsets, part.contentInsets];
  for (const [gi, group] of spec.stateGroups.entries()) {
    const p = `/stateGroups/${gi}`;
    unique('group', group.id, `${p}/id`);
    const first = assets.get(group.assetIds[0]);
    const states = new Set();
    for (const [i, id] of group.assetIds.entries()) {
      const part = assets.get(id), path = `${p}/assetIds/${i}`;
      if (!part) { error(path, 'reference.asset', '状态组引用的资产不存在。'); continue; }
      if (grouped.has(id)) error(path, 'state.membership', '同一资产只能属于一个状态组。');
      grouped.add(id);
      if (states.has(part.state)) error(path, 'state.duplicate', '同组成员的 state 不能重复。');
      states.add(part.state);
      if (first && JSON.stringify(stateGeometry(part)) !== JSON.stringify(stateGeometry(first))) error(path, 'state.geometry', '同组状态必须共享主体尺寸、相对槽位偏移、形状、伸缩方式和边距。');
    }
  }
  return issues;
}

export async function readTemplate(path) {
  const bytes = await readFile(path);
  let spec;
  try { spec = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { fail('/', 'json.syntax', '不是有效的 JSON 文档。'); }
  const issues = validateTemplate(spec);
  if (issues.length) throw new TemplateError(issues);
  return { bytes, spec };
}
