import { validatePanelSpec, validatePanelState } from './spec.mjs';
import { validateCatalog, resolveRecipe, resolveTheme } from './catalog.mjs';
import { validatePanelAssetClosure, panelAssetPath } from './panel-assets.mjs';
import { measureFlowLayout } from './flow-layout.mjs';
import { progressDisplayValue, progressDisplayMax, progressText, progressValueWidth } from './progress.mjs';

export const PANEL_COMPILER_VERSION = '0.1.0';
export const ASSET_PANEL_COMPILER_VERSION = '0.2.0';
export const CONTROLS_PANEL_COMPILER_VERSION = '0.3.0';
export const LEGACY_FLOW_PANEL_COMPILER_VERSION = '0.4.0';
export const FLOW_PANEL_COMPILER_VERSION = '0.4.1';
export const LEGACY_PROGRESS_PANEL_COMPILER_VERSION = '0.5.0';
export const PROGRESS_PANEL_COMPILER_VERSION = '0.5.1';

export class PanelCompileError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message} [${code}]`);
    this.name = 'PanelCompileError'; this.code = code; this.path = path;
  }
}
const fail = (code, path, message) => { throw new PanelCompileError(code, path, message); };

export function controlId(specId, rowId) { return `${specId}.row.${rowId}.control`; }
export function choiceId(specId, rowId, optionId) { return `${controlId(specId, rowId)}.option.${optionId}`; }

// Black or white against an opaque theme accent: choose the higher sRGB contrast ratio.
function buttonForeground(background) {
  const channels = [1, 3, 5].map(offset => parseInt(background.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}

export function initialPanelState(spec) {
  const checked = validatePanelSpec(spec);
  return Object.fromEntries(checked.state.map(field => [field.id, field.initial]));
}

/** Pure lowering. Renderer-free; core functions are supplied by the host adapter. */
export function compilePanel(input, catalogInput, core, stateInput, assetClosureInput, compilerVersionInput) {
  const spec = validatePanelSpec(input), catalog = validateCatalog(catalogInput);
  const progressVersion = spec.panelSpecVersion === '0.5';
  const flowVersion = progressVersion || spec.panelSpecVersion === '0.4';
  const controls = flowVersion || spec.panelSpecVersion === '0.3';
  const compilerVersion = compilerVersionInput ?? (progressVersion ? PROGRESS_PANEL_COMPILER_VERSION : flowVersion ? FLOW_PANEL_COMPILER_VERSION
    : controls ? CONTROLS_PANEL_COMPILER_VERSION : spec.assets ? ASSET_PANEL_COMPILER_VERSION : PANEL_COMPILER_VERSION);
  const allowedVersions = progressVersion ? [PROGRESS_PANEL_COMPILER_VERSION, LEGACY_PROGRESS_PANEL_COMPILER_VERSION] : flowVersion ? [FLOW_PANEL_COMPILER_VERSION, LEGACY_FLOW_PANEL_COMPILER_VERSION]
    : [controls ? CONTROLS_PANEL_COMPILER_VERSION : spec.assets ? ASSET_PANEL_COMPILER_VERSION : PANEL_COMPILER_VERSION];
  if (!allowedVersions.includes(compilerVersion)) fail('COMPILER_VERSION', '$.compilerVersion', 'Compiler version must match the spec');
  const assetClosure = validatePanelAssetClosure(spec, assetClosureInput);
  const assets = new Map((assetClosure?.records ?? []).map(r => [r.key, r]));
  const rowIcons = new Map((spec.assets?.rowIcons ?? []).map(r => [r.rowId, r.asset]));
  const imageFacts = {};
  if (typeof core?.compileTree !== 'function' || typeof core?.validateDocument !== 'function') {
    fail('COMPONENT_CORE_REQUIRED', '$', 'A compatible component compiler must be supplied');
  }
  const state = validatePanelState(spec, stateInput === undefined ? initialPanelState(spec) : stateInput);
  const flow = flowVersion ? measureFlowLayout(spec) : null;
  const theme = resolveTheme(catalog, spec.theme), t = theme.tokens, l = { ...spec.layout, width: flow?.width ?? spec.layout.width };
  const selected = new Map();
  const select = (ref, kind, width, height) => {
    const recipe = resolveRecipe(catalog, ref, kind);
    if (!recipe.supports.includes('pixi')) fail('CAPABILITY_UNSUPPORTED', '$.catalog', 'Recipe does not support the Pixi target');
    if (width < recipe.minWidth || height < recipe.minHeight) fail('RECIPE_GEOMETRY', '$.layout', `Recipe ${recipe.id} minimum size is not met`);
    selected.set(`${recipe.id}@${recipe.version}`, { id: recipe.id, version: recipe.version });
    return recipe;
  };
  const contentWidth = l.width - l.padding * 2;
  const sectionHeight = section => l.sectionTitleHeight + l.gap + section.rows.length * l.rowHeight + (section.rows.length - 1) * l.gap;
  const panelHeight = flow?.panelHeight ?? l.padding * 2 + l.titleHeight + l.gap
    + spec.sections.reduce((sum, section) => sum + sectionHeight(section), 0)
    + (spec.sections.length - 1) * l.sectionGap;
  if (l.width > spec.canvas.width || panelHeight > spec.canvas.height || contentWidth <= 0) {
    fail('LAYOUT_OVERFLOW', '$.layout', 'Panel must fit the declared canvas; no clipping or automatic shrinking');
  }
  if (l.titleHeight < t.titleSize * 1.3 || l.sectionTitleHeight < t.headingSize * 1.3 || l.rowHeight < t.fontSize * 1.3) {
    fail('TEXT_HEIGHT', '$.layout', 'Text slots must fit the selected theme line height');
  }
  select({ id: 'settings.panel', version: '0.1.0' }, 'panel', l.width, panelHeight);
  const style = (backgroundColor, extras = {}) => ({
    backgroundColor, borderColor: t.border, borderWidth: 0, cornerRadius: t.radius,
    textColor: t.text, fontFamily: t.fontFamily, fontSize: t.fontSize,
    fontWeight: 'normal', opacity: 1, ...extras,
  });
  const layouts = {}, bindings = [], actions = [], textBindings = [];
  const node = (id, componentType, rect, props, children) => {
    if (Object.hasOwn(layouts, id)) fail('GENERATED_ID_COLLISION', '$.id', 'Generated IDs must be unique');
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
      fail('LAYOUT_GEOMETRY', '$.layout', 'Every generated rectangle must have a positive finite size');
    }
    layouts[id] = rect;
    return { id, componentType, props, ...(children ? { children } : {}) };
  };
  const text = (id, value, rect, fontSize, color = t.text, weight = 'normal') => node(id, 'Text', rect, {
    text: value, wrap: 'none', overflow: 'error', lineHeight: Math.ceil(fontSize * 1.3), drawBackground: false,
    style: style(t.surface, { textColor: color, fontSize, fontWeight: weight }),
  });
  const children = [text(`${spec.id}.title`, spec.title,
    { x: l.padding, y: l.padding, width: contentWidth, height: l.titleHeight }, t.titleSize, t.text, 'bold')];
  const bodyChildren = flow ? [] : children;
  const image = (id, record, rect, region, badge = false) => {
    const source = panelAssetPath(record);
    imageFacts[source] = { width: record.width, height: record.height };
    return node(id, 'Image', rect, { source, ...(region ? { region } : {}), fit: region ? 'stretch' : 'contain',
      drawBackground: badge, style: style(t.accent, { cornerRadius: 6 }) });
  };
  let legacySectionY = l.padding + l.titleHeight + l.gap;
  const fields = new Map(spec.state.map(field => [field.id, field]));
  const orderedSections = flow ? flow.sections.map(place => spec.sections.find(section => section.id === place.id)) : spec.sections;
  for (const section of orderedSections) {
    const place = flow?.sections.find(value => value.id === section.id);
    const contentWidth = place?.width ?? l.width - l.padding * 2;
    const sectionY = place?.y ?? legacySectionY;
    const height = sectionHeight(section);
    select({ id: 'settings.section', version: '0.1.0' }, 'section', contentWidth, height);
    const sectionId = `${spec.id}.section.${section.id}`;
    const sectionChildren = [text(`${sectionId}.title`, section.title,
      { x: 0, y: 0, width: contentWidth, height: l.sectionTitleHeight }, t.headingSize, t.muted, 'bold')];
    for (const [index, row] of section.rows.entries()) {
      const rowId = `${spec.id}.row.${row.id}`, id = controlId(spec.id, row.id), field = fields.get(row.bind);
      select(row.recipe, `${row.kind}-row`, contentWidth, l.rowHeight);
      const textHeight = Math.ceil(t.fontSize * 1.3);
      const icon = assets.get(rowIcons.get(row.id)), iconOffset = icon ? 40 : 0;
      const fullButton = flowVersion && row.kind === 'button' && row.label === '';
      if (icon && (l.rowHeight < 40 || (!fullButton && l.labelWidth - iconOffset < t.fontSize * 2))) fail('ICON_GEOMETRY', '$.layout', 'Icon needs a 28px slot and a readable label');
      const rowChildren = fullButton ? [] : [text(`${rowId}.label`, row.label,
        { x: 12 + iconOffset, y: (l.rowHeight - textHeight) / 2, width: l.labelWidth - iconOffset, height: textHeight }, t.fontSize)];
      if (icon) rowChildren.unshift(image(`${rowId}.icon`, icon, { x: 12, y: (l.rowHeight - 28) / 2, width: 28, height: 28 }, null, true));
      const controlX = fullButton ? 12 + iconOffset : l.labelWidth + l.gap + 12;
      const available = contentWidth - controlX - 12;
      const rowY = l.sectionTitleHeight + l.gap + index * (l.rowHeight + l.gap);
      if (row.kind === 'slider') {
        const valueWidth = Math.max(64, t.fontSize * 4), sliderWidth = available - valueWidth - l.gap;
        if (sliderWidth < 96) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Slider needs at least 96 logical pixels after label and value slots');
        rowChildren.push(node(id, 'Slider', { x: controlX, y: 0, width: sliderWidth, height: l.rowHeight }, {
          value: state[row.bind], min: field.min, max: field.max, step: field.step, enabled: row.enabled,
          style: style(t.control, { borderColor: t.accent }),
        }));
        const valueId = `${rowId}.value`;
        rowChildren.push(text(valueId, `${row.format.prefix}${state[row.bind].toFixed(row.format.fractionDigits)}${row.format.suffix}`,
          { x: contentWidth - valueWidth - 12, y: (l.rowHeight - textHeight) / 2, width: valueWidth, height: textHeight }, t.fontSize, t.accent));
        textBindings.push({ sourceId: id, targetId: valueId, parts: [row.format.prefix,
          { field: 'value', fractionDigits: row.format.fractionDigits, grouping: 'none' }, row.format.suffix] });
      } else if (row.kind === 'progress') {
        const valueWidth = compilerVersion === LEGACY_PROGRESS_PANEL_COMPILER_VERSION
          ? Math.max(64, t.fontSize * (row.format.fractionDigits + 4)) : progressValueWidth(row, field, t.fontSize);
        const barWidth = available - valueWidth - l.gap;
        if (barWidth < 96) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Progress needs a bar and a readable value slot');
        rowChildren.push(node(id, 'ProgressBar', { x: controlX, y: (l.rowHeight - 16) / 2, width: barWidth, height: 16 }, {
          value: progressDisplayValue(row, field, state[row.bind]), max: progressDisplayMax(row, field),
          style: style(t.border, { borderColor: t.accent, cornerRadius: 8 }),
        }));
        const valueId = `${rowId}.value`, suffix = row.format.mode === 'percent' ? '%' : '';
        rowChildren.push(text(valueId, progressText(row, field, state[row.bind]),
          { x: contentWidth - valueWidth - 12, y: (l.rowHeight - textHeight) / 2, width: valueWidth, height: textHeight }, t.fontSize, t.accent));
        textBindings.push({ sourceId: id, targetId: valueId, parts: [
          { field: 'value', fractionDigits: row.format.fractionDigits, grouping: 'none' }, suffix] });
      } else if (row.kind === 'switch') {
        if (available < 76) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Switch needs at least 76 logical pixels');
        rowChildren.push(node(id, 'Switch', { x: contentWidth - 88, y: 0, width: 76, height: l.rowHeight }, {
          label: '', checked: state[row.bind], enabled: row.enabled, style: style(t.control, { borderColor: t.accent }),
        }));
      } else if (row.kind === 'text') {
        if (available <= 0) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Text values need a positive content slot');
        rowChildren.push(text(id, row.text, { x: controlX, y: (l.rowHeight - textHeight) / 2, width: available, height: textHeight }, t.fontSize));
      } else {
        const controlHeight = 40, controlY = (l.rowHeight - controlHeight) / 2;
        if (available < 120) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Select and Button need at least 120 logical pixels');
        if (controlY < 0 || controlHeight < t.fontSize * 1.3) fail('CONTROL_HEIGHT', '$.layout.rowHeight', 'Select and Button use a 40px control with a fitting text line');
        const rect = { x: controlX, y: controlY, width: available, height: controlHeight };
        if (row.kind === 'select') {
          // The sibling renderer opens an overlay below the field with a 2px gap.
          // Its default menu uses one max(32, fieldHeight) row per option and never flips.
          const popupBottom = (flow ? flow.panelY + flow.body.y : (spec.canvas.height - panelHeight) / 2) + sectionY + rowY + controlY
            + controlHeight + 2 + Math.max(32, controlHeight) * field.options.length;
          if (!flow?.scrollable && popupBottom > spec.canvas.height) fail('SELECT_POPUP_OVERFLOW', '$.canvas.height', 'The open Select menu must fit below its field within the canvas');
          rowChildren.push(node(id, 'Select', rect, {
            selectedId: choiceId(spec.id, row.id, state[row.bind]),
            options: field.options.map(option => ({ id: choiceId(spec.id, row.id, option.id), label: option.label })),
            enabled: row.enabled,
            // The default runtime popup is white/light green. An explicit light-field
            // palette keeps text legible there and in the collapsed field, including dark themes.
            style: style('#F1F5FC', { textColor: '#111622', borderWidth: 1, cornerRadius: 6 }),
          }));
        } else {
          rowChildren.push(node(id, 'Button', rect, {
            label: row.buttonLabel, enabled: row.enabled,
            style: style(t.accent, { textColor: buttonForeground(t.accent), fontWeight: 'bold', cornerRadius: 6 }),
          }, []));
          actions.push({ nodeId: id, rowId: row.id, event: row.event, enabled: row.enabled, action: row.action });
        }
      }
      if (Object.hasOwn(row, 'bind')) bindings.push(row.kind === 'progress'
        ? { nodeId: id, fieldId: row.bind, type: 'progress', readOnly: true }
        : { nodeId: id, fieldId: row.bind, event: row.event, type: field.type, enabled: row.enabled });
      if (fullButton && [FLOW_PANEL_COMPILER_VERSION, PROGRESS_PANEL_COMPILER_VERSION, LEGACY_PROGRESS_PANEL_COMPILER_VERSION].includes(compilerVersion)) {
        // Container always paints in the shared contract. Emit the standalone button
        // (and optional icon) directly, preserving its ID and absolute geometry.
        for (const child of rowChildren) {
          layouts[child.id] = { ...layouts[child.id], y: layouts[child.id].y + rowY };
          sectionChildren.push(child);
        }
      } else sectionChildren.push(node(rowId, 'Container', {
        x: 0, y: rowY, width: contentWidth, height: l.rowHeight,
      }, { style: style(t.control) }, rowChildren));
    }
    bodyChildren.push(node(sectionId, 'Container', { x: place?.x ?? l.padding, y: sectionY, width: contentWidth, height },
      { style: style(t.surface) }, sectionChildren));
    legacySectionY += height + l.sectionGap;
  }
  if (flow) children.push(node(`${spec.id}.body`, flow.scrollable ? 'ScrollView' : 'Container', flow.body,
    flow.scrollable ? { scrollX: 0, scrollY: 0, contentWidth: flow.body.width, contentHeight: flow.contentHeight,
      drawBackground: false, scrollbarVisibility: 'auto', style: style(t.surface) } : { style: style(t.surface) }, bodyChildren));
  const surface = assets.get(spec.assets?.panelSurface);
  if (surface) {
    const { left, right, top, bottom } = surface.slice;
    if (l.width <= left + right || panelHeight <= top + bottom) fail('SURFACE_GEOMETRY', '$.layout', 'Panel must exceed the fixed slice borders');
    const sx = [0, left, surface.width - right, surface.width], sy = [0, top, surface.height - bottom, surface.height];
    const dx = [0, left, l.width - right, l.width], dy = [0, top, panelHeight - bottom, panelHeight];
    const slices = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      if (sx[x + 1] === sx[x] || sy[y + 1] === sy[y]) continue;
      slices.push(image(`${spec.id}.panel.surface.${y}.${x}`, surface,
        { x: dx[x], y: dy[y], width: dx[x + 1] - dx[x], height: dy[y + 1] - dy[y] },
        { x: sx[x], y: sy[y], width: sx[x + 1] - sx[x], height: sy[y + 1] - sy[y] }));
    }
    children.unshift(...slices);
  }
  const card = node(`${spec.id}.panel`, 'Container', {
    x: flow?.panelX ?? (spec.canvas.width - l.width) / 2, y: flow?.panelY ?? (spec.canvas.height - panelHeight) / 2, width: l.width, height: panelHeight,
  }, { style: style(t.surface, { borderWidth: 1 }) }, children);
  const root = node(`${spec.id}.canvas`, 'Container', { x: 0, y: 0, ...spec.canvas }, { style: style(t.background, { cornerRadius: 0 }) }, [card]);
  const intent = { intentVersion: '0.2', id: spec.id, root };
  const policy = { canvas: spec.canvas, layout: layouts, layoutSource: {
    kind: 'explicit', description: `Explicit rectangles produced by UI Panel compiler ${compilerVersion} from declared ${flowVersion ? 'flow container' : 'stack'} rules; not image measurements.`,
  } };
  const document = core.compileTree(intent, imageFacts, policy);
  if (textBindings.length) document.valueTextBindings = { version: '1.0', bindings: textBindings };
  return {
    document: core.validateDocument(document), intent, policy, bindings, state, ...(controls ? { actions } : {}),
    selection: { theme: { id: theme.id, version: theme.version }, recipes: [...selected.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) },
  };
}
