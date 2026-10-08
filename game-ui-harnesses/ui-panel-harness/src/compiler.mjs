import { validatePanelSpec, validatePanelState } from './spec.mjs';
import { validateCatalog, resolveRecipe, resolveTheme } from './catalog.mjs';
import { validatePanelAssetClosure, panelAssetPath } from './panel-assets.mjs';
import { measureFlowLayout, measureTabbedLayout } from './flow-layout.mjs';
import { tabPageId } from './tabs.mjs';
import { progressDisplayValue, progressDisplayMax, progressText, progressValueWidth } from './progress.mjs';
import { createPresentationPolicy, presentationTextWidth } from './panel-presentation.mjs';
import { formErrorId, inputError, buttonEnabled } from './forms.mjs';
import { staticTextWidth, wrappedLinePresentation } from './text-wrap.mjs';
import { buttonFontSize } from './button-font.mjs';
import { appearanceTokens } from './appearance.mjs';
import { selectSkin } from './select-skin.mjs';
import { tabsSkin } from './tabs-skin.mjs';

export const PANEL_COMPILER_VERSION = '0.1.0';
export const ASSET_PANEL_COMPILER_VERSION = '0.2.0';
export const CONTROLS_PANEL_COMPILER_VERSION = '0.3.0';
export const LEGACY_FLOW_PANEL_COMPILER_VERSION = '0.4.0';
export const FLOW_PANEL_COMPILER_VERSION = '0.4.1';
export const LEGACY_PROGRESS_PANEL_COMPILER_VERSION = '0.5.0';
export const PROGRESS_PANEL_COMPILER_VERSION = '0.5.1';
export const TABS_PANEL_COMPILER_VERSION = '0.6.0';
export const FORMS_PANEL_COMPILER_VERSION = '0.7.0';
export const MODERN_PANEL_COMPILER_VERSION = '0.7.1';
export const THEMED_PANEL_COMPILER_VERSION = '0.7.2';
export const ADAPTIVE_PANEL_COMPILER_VERSION = '0.7.3';
export const APPEARANCE_PANEL_COMPILER_VERSION = '0.8.0';
export const ACTION_LAYOUT_PANEL_COMPILER_VERSION = '0.9.0';
export const BUTTON_STYLE_PANEL_COMPILER_VERSION = '0.10.0';
export const BUTTON_FONT_PANEL_COMPILER_VERSION = '0.11.0';
export const TITLE_BAR_PANEL_COMPILER_VERSION = '0.12.0';
export const TEXT_WRAP_PANEL_COMPILER_VERSION = '0.13.0';
export const FRAME_PANEL_COMPILER_VERSION = '0.14.0';
export const SEMANTIC_PANEL_COMPILER_VERSION = '0.15.0';
export const FOCUSED_PANEL_COMPILER_VERSION = '0.16.0';
export const NAVIGATION_PANEL_COMPILER_VERSION = '0.17.0';

/** New themes opt in explicitly; old bundles continue to replay their exact compiler. */
export function defaultPanelCompilerVersion(spec, catalog) {
  const theme = resolveTheme(catalog, spec.theme), profile = theme.visualStyle;
  if (theme.controlStyle === 'semantic-v1') {
    if (!['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(spec.panelSpecVersion)) throw new PanelCompileError('VISUAL_STYLE_VERSION', '$.theme', 'Semantic controls require PanelSpec 0.7 or later');
    return theme.navigationStyle === 'tabs-v1' ? NAVIGATION_PANEL_COMPILER_VERSION : theme.presentationStyle === 'focused-v1' ? FOCUSED_PANEL_COMPILER_VERSION : SEMANTIC_PANEL_COMPILER_VERSION;
  }
  if (['0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(spec.panelSpecVersion)) {
    if (profile !== 'modern-v3') throw new PanelCompileError('VISUAL_STYLE_VERSION', '$.theme', 'Panel appearance requires modern-v3');
    return spec.panelSpecVersion === '0.14' ? FRAME_PANEL_COMPILER_VERSION : spec.panelSpecVersion === '0.13' ? TEXT_WRAP_PANEL_COMPILER_VERSION : spec.panelSpecVersion === '0.12' ? TITLE_BAR_PANEL_COMPILER_VERSION : spec.panelSpecVersion === '0.11' ? BUTTON_FONT_PANEL_COMPILER_VERSION : spec.panelSpecVersion === '0.10' ? BUTTON_STYLE_PANEL_COMPILER_VERSION : spec.panelSpecVersion === '0.9' ? ACTION_LAYOUT_PANEL_COMPILER_VERSION : APPEARANCE_PANEL_COMPILER_VERSION;
  }
  if (['modern-v1', 'modern-v2', 'modern-v3'].includes(profile)) {
    if (spec.panelSpecVersion !== '0.7') throw new PanelCompileError('VISUAL_STYLE_VERSION', '$.theme', 'Modern visual style requires PanelSpec 0.7');
    return profile === 'modern-v3' ? ADAPTIVE_PANEL_COMPILER_VERSION : profile === 'modern-v2' ? THEMED_PANEL_COMPILER_VERSION : MODERN_PANEL_COMPILER_VERSION;
  }
  return spec.panelSpecVersion === '0.7' ? FORMS_PANEL_COMPILER_VERSION
    : spec.panelSpecVersion === '0.6' ? TABS_PANEL_COMPILER_VERSION
    : spec.panelSpecVersion === '0.5' ? PROGRESS_PANEL_COMPILER_VERSION
    : spec.panelSpecVersion === '0.4' ? FLOW_PANEL_COMPILER_VERSION
    : spec.panelSpecVersion === '0.3' ? CONTROLS_PANEL_COMPILER_VERSION
    : spec.assets ? ASSET_PANEL_COMPILER_VERSION : PANEL_COMPILER_VERSION;
}

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

function contrast(foreground, background) {
  const luminance = color => {
    const c = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// The shared default Select popup and Tabs headers paint light surfaces.
// Keep their field/header and menu text in one readable palette without
// changing the component runtime or introducing theme-specific raster assets.
function navigationPalette(tokens) {
  const light = contrast(tokens.text, '#FFFFFF') >= 4.5 && contrast(tokens.text, '#E3F1EC') >= 4.5;
  const background = light ? tokens.surface : '#F1F6F4', text = light ? tokens.text : '#183A36';
  let accent = tokens.accent;
  for (let i = 0; i < 16 && Math.min(contrast(accent, background), contrast(accent, '#E8F3EE')) < 3; i++) {
    accent = '#' + [1, 3, 5].map(offset => Math.floor(parseInt(accent.slice(offset, offset + 2), 16) * 0.8).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return { background, text, accent };
}

export function initialPanelState(spec) {
  const checked = validatePanelSpec(spec);
  return Object.fromEntries(checked.state.map(field => [field.id, field.initial]));
}

/** Pure lowering. Renderer-free; core functions are supplied by the host adapter. */
export function compilePanel(input, catalogInput, core, stateInput, assetClosureInput, compilerVersionInput) {
  const spec = validatePanelSpec(input), catalog = validateCatalog(catalogInput);
  const sized = spec.panelSpecVersion === '0.14', wrapping = sized || spec.panelSpecVersion === '0.13', titled = wrapping || spec.panelSpecVersion === '0.12', typography = titled || spec.panelSpecVersion === '0.11', individual = typography || spec.panelSpecVersion === '0.10', arranged = individual || spec.panelSpecVersion === '0.9', styled = arranged || spec.panelSpecVersion === '0.8', appearance = styled ? spec.appearance : null;
  const formsVersion = styled || spec.panelSpecVersion === '0.7';
  const tabsVersion = formsVersion || spec.panelSpecVersion === '0.6';
  const progressVersion = tabsVersion || spec.panelSpecVersion === '0.5';
  const flowVersion = progressVersion || spec.panelSpecVersion === '0.4';
  const controls = flowVersion || spec.panelSpecVersion === '0.3';
  const compilerVersion = compilerVersionInput ?? defaultPanelCompilerVersion(spec, catalog);
  const allowedVersions = sized ? [FRAME_PANEL_COMPILER_VERSION] : wrapping ? [TEXT_WRAP_PANEL_COMPILER_VERSION] : titled ? [TITLE_BAR_PANEL_COMPILER_VERSION] : typography ? [BUTTON_FONT_PANEL_COMPILER_VERSION] : individual ? [BUTTON_STYLE_PANEL_COMPILER_VERSION] : arranged ? [ACTION_LAYOUT_PANEL_COMPILER_VERSION] : styled ? [APPEARANCE_PANEL_COMPILER_VERSION] : formsVersion ? [FORMS_PANEL_COMPILER_VERSION, MODERN_PANEL_COMPILER_VERSION, THEMED_PANEL_COMPILER_VERSION, ADAPTIVE_PANEL_COMPILER_VERSION] : tabsVersion ? [TABS_PANEL_COMPILER_VERSION] : progressVersion ? [PROGRESS_PANEL_COMPILER_VERSION, LEGACY_PROGRESS_PANEL_COMPILER_VERSION] : flowVersion ? [FLOW_PANEL_COMPILER_VERSION, LEGACY_FLOW_PANEL_COMPILER_VERSION]
    : [controls ? CONTROLS_PANEL_COMPILER_VERSION : spec.assets ? ASSET_PANEL_COMPILER_VERSION : PANEL_COMPILER_VERSION];
  const semantic = resolveTheme(catalog, spec.theme).controlStyle === 'semantic-v1';
  if (semantic ? compilerVersion !== defaultPanelCompilerVersion(spec, catalog) : !allowedVersions.includes(compilerVersion)) fail('COMPILER_VERSION', '$.compilerVersion', 'Compiler version must match the spec and pinned theme');
  const assetClosure = validatePanelAssetClosure(spec, assetClosureInput);
  const assets = new Map((assetClosure?.records ?? []).map(r => [r.key, r]));
  const rowIcons = new Map((spec.assets?.rowIcons ?? []).map(r => [r.rowId, r.asset]));
  const imageFacts = {};
  const generatedResources = new Map();
  if (typeof core?.compileTree !== 'function' || typeof core?.validateDocument !== 'function') {
    fail('COMPONENT_CORE_REQUIRED', '$', 'A compatible component compiler must be supplied');
  }
  const state = validatePanelState(spec, stateInput === undefined ? initialPanelState(spec) : stateInput);
  const theme = resolveTheme(catalog, spec.theme), t = appearanceTokens(theme.tokens, appearance);
  const adaptive = theme.visualStyle === 'modern-v3', themed = adaptive || theme.visualStyle === 'modern-v2', modern = themed || theme.visualStyle === 'modern-v1';
  const presentationPolicy = adaptive ? createPresentationPolicy(spec, t, theme.presentationStyle) : undefined;
  const flow = tabsVersion && spec.tabs ? measureTabbedLayout(spec, presentationPolicy) : flowVersion ? measureFlowLayout(spec, presentationPolicy) : null;
  const l = { ...spec.layout, width: flow?.width ?? spec.layout.width };
  if (!semantic && (styled ? !adaptive : modern ? compilerVersion !== (adaptive ? ADAPTIVE_PANEL_COMPILER_VERSION : themed ? THEMED_PANEL_COMPILER_VERSION : MODERN_PANEL_COMPILER_VERSION)
    : [MODERN_PANEL_COMPILER_VERSION, THEMED_PANEL_COMPILER_VERSION, ADAPTIVE_PANEL_COMPILER_VERSION].includes(compilerVersion))
    ) fail('VISUAL_STYLE_VERSION', '$.compilerVersion', 'Visual style and compiler version must match');
  const navigation = themed ? navigationPalette(t) : null;
  const errorColor = themed && contrast('#B22C42', t.control) < 4.5 ? '#FDA29B' : '#B22C42';
  const selected = new Map();
  const select = (ref, kind, width, height) => {
    const recipe = resolveRecipe(catalog, ref, kind);
    if (recipe.buttonRole && !semantic) fail('BUTTON_ROLE_THEME', '$.theme', 'Explicit button roles require semantic-v1 controls');
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
  const titleBar = spec.titleBar, titlePadding = titleBar?.padding ?? 0, titleSize = titleBar?.fontSize ?? t.titleSize;
  const titleWidth = contentWidth - 2 * titlePadding, titleHeight = l.titleHeight - 2 * titlePadding;
  if (titleBar && (Math.ceil(titleSize * 1.3) > titleHeight || presentationTextWidth(spec.title,titleSize) > titleWidth)) fail('TITLE_BAR_FIT', '$.titleBar', 'Title does not fit its existing slot; reduce font/padding or explicitly increase title height');
  const hasPlate = titleBar?.backgroundColor != null;
  const titleNode = text(`${spec.id}.title`, spec.title,
    { x: (hasPlate ? 0 : l.padding) + titlePadding, y: (hasPlate ? 0 : l.padding) + titlePadding, width: titleWidth, height: titleHeight }, titleSize, titleBar?.textColor ?? t.text, 'bold');
  const children = [hasPlate ? node(`${spec.id}.title-bar`, 'Container', { x:l.padding, y:l.padding, width:contentWidth, height:l.titleHeight },
    { style:style(titleBar.backgroundColor,{cornerRadius:titleBar.cornerRadius ?? t.radius}) }, [titleNode]) : titleNode];
  if (modern && !adaptive && l.gap >= 4) children.push(node(`${spec.id}.title-divider`, 'Container',
    { x: l.padding, y: l.padding + l.titleHeight + l.gap / 2, width: contentWidth, height: 1 },
    { style: style(t.border, { cornerRadius: 0 }) }, []));
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
    const presentation = place?.presentation;
    const height = place?.height ?? sectionHeight(section);
    select({ id: 'settings.section', version: '0.1.0' }, 'section', contentWidth, height);
    const sectionId = `${spec.id}.section.${section.id}`;
    const sectionChildren = presentation?.showTitle === false ? [] : [text(`${sectionId}.title`, section.title,
      { x: 0, y: 0, width: contentWidth, height: l.sectionTitleHeight }, t.headingSize, t.muted, 'bold')];
    for (const [index, row] of section.rows.entries()) {
      const rowId = `${spec.id}.row.${row.id}`, id = controlId(spec.id, row.id), field = fields.get(row.bind);
      const placement = presentation?.rows[index], rowHeight = placement?.height ?? l.rowHeight;
      select(row.recipe, `${row.kind}-row`, contentWidth, rowHeight);
      const textHeight = Math.ceil(t.fontSize * 1.3);
      const icon = assets.get(rowIcons.get(row.id)), iconOffset = icon ? 40 : 0;
      const fullButton = flowVersion && row.kind === 'button' && row.label === '';
      const stacked = placement?.stacked === true;
      if (icon && (rowHeight < 40 || (!fullButton && !stacked && l.labelWidth - iconOffset < t.fontSize * 2))) fail('ICON_GEOMETRY', '$.layout', 'Icon needs a 28px slot and a readable label');
      const rowChildren = fullButton || (placement?.copy && !row.label) ? [] : [text(`${rowId}.label`, row.label,
        { x: (placement?.labelX ?? 12) + iconOffset, y: placement?.labelY ?? (placement?.textBlock ? 12 : stacked ? 0 : modern && row.kind === 'input' ? 4 + (40 - textHeight) / 2 : (rowHeight - textHeight) / 2), width: placement?.labelX !== undefined ? contentWidth - 2 * placement.labelX - iconOffset : stacked ? contentWidth - 24 - iconOffset : l.labelWidth - iconOffset, height: textHeight }, t.fontSize)];
      if (icon) rowChildren.unshift(image(`${rowId}.icon`, icon, { x: placement?.iconX ?? 12, y: stacked ? 0 : (rowHeight - 28) / 2, width: stacked ? 24 : 28, height: stacked ? 24 : 28 }, null, true));
      const controlX = placement?.controlX ?? (stacked ? 12 : fullButton ? 12 + iconOffset : l.labelWidth + l.gap + 12);
      const available = placement?.controlWidth ?? contentWidth - controlX - 12;
      const rowY = placement?.y ?? l.sectionTitleHeight + l.gap + index * (l.rowHeight + l.gap);
      if (row.kind === 'input') {
        if (available < 160 || rowHeight < (stacked ? 2 * textHeight + 60 : 48 + textHeight)) fail('INPUT_GEOMETRY', '$.layout', 'Input and validation need a readable field and error line');
        rowChildren.push(node(id, 'Input', { x: controlX, y: stacked ? textHeight + 8 : 4, width: available, height: stacked ? 44 : 40 }, {
          value: state[row.bind], placeholder: row.placeholder, inputType: row.inputType, readOnly: row.readOnly,
          maxLength: field.maxLength, enabled: row.enabled, valueOverflow: 'ellipsis',
          style: style(appearance?.controlColor ?? (modern && row.readOnly ? t.control : t.surface), { borderWidth: 1, cornerRadius: appearance?.controlRadius ?? (modern ? 8 : 6),
            ...(modern ? { borderColor: t.accent } : {}) }),
        }));
        for (const [code, message] of [['required', row.validation.requiredMessage], ['min-length', row.validation.minLengthMessage]])
          rowChildren.push(text(formErrorId(spec.id, row.id, code), message,
            { x: controlX, y: stacked ? textHeight + 60 : 48, width: available, height: textHeight }, t.fontSize, errorColor));
      } else if (row.kind === 'slider') {
        const valueWidth = Math.max(64, t.fontSize * 4), sliderWidth = available - valueWidth - l.gap;
        if (sliderWidth < 96) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Slider needs at least 96 logical pixels after label and value slots');
        rowChildren.push(node(id, 'Slider', { x: controlX, y: 0, width: sliderWidth, height: rowHeight }, {
          value: state[row.bind], min: field.min, max: field.max, step: field.step, enabled: row.enabled,
          style: style(t.control, { borderColor: t.accent }),
        }));
        const valueId = `${rowId}.value`;
        rowChildren.push(text(valueId, `${row.format.prefix}${state[row.bind].toFixed(row.format.fractionDigits)}${row.format.suffix}`,
          { x: contentWidth - valueWidth - 12, y: (rowHeight - textHeight) / 2, width: valueWidth, height: textHeight }, t.fontSize, appearance?.textColor ?? t.accent));
        textBindings.push({ sourceId: id, targetId: valueId, parts: [row.format.prefix,
          { field: 'value', fractionDigits: row.format.fractionDigits, grouping: 'none' }, row.format.suffix] });
      } else if (row.kind === 'progress') {
        const valueWidth = compilerVersion === LEGACY_PROGRESS_PANEL_COMPILER_VERSION
          ? Math.max(64, t.fontSize * (row.format.fractionDigits + 4)) : progressValueWidth(row, field, t.fontSize);
        const barWidth = available - valueWidth - l.gap;
        if (barWidth < 96) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Progress needs a bar and a readable value slot');
        rowChildren.push(node(id, 'ProgressBar', { x: controlX, y: (rowHeight - 16) / 2, width: barWidth, height: 16 }, {
          value: progressDisplayValue(row, field, state[row.bind]), max: progressDisplayMax(row, field),
          style: style(appearance?.controlColor ?? t.border, { borderColor: t.accent, cornerRadius: 8 }),
        }));
        const valueId = `${rowId}.value`, suffix = row.format.mode === 'percent' ? '%' : '';
        rowChildren.push(text(valueId, progressText(row, field, state[row.bind]),
          { x: contentWidth - valueWidth - 12, y: (rowHeight - textHeight) / 2, width: valueWidth, height: textHeight }, t.fontSize, appearance?.textColor ?? t.accent));
        textBindings.push({ sourceId: id, targetId: valueId, parts: [
          { field: 'value', fractionDigits: row.format.fractionDigits, grouping: 'none' }, suffix] });
      } else if (row.kind === 'switch') {
        if (available < 76) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Switch needs at least 76 logical pixels');
        rowChildren.push(node(id, 'Switch', { x: contentWidth - 88, y: 0, width: 76, height: rowHeight }, {
          label: '', checked: state[row.bind], enabled: row.enabled, style: style(t.control, { borderColor: t.accent }),
        }));
      } else if (row.kind === 'text') {
        if (available <= 0) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Text values need a positive content slot');
        if (placement?.textBlock) {
          const block=placement.textBlock;
          block.lines.forEach((line,i)=>{
            const {text:value,indent}=wrappedLinePresentation(line,t.fontSize);
            rowChildren.push(text(i===0?id:id+'.line'+i,value,{x:controlX+indent,y:(placement.copyTextY ?? 12+textHeight+8)+i*block.lineHeight,width:available-indent,height:block.lineHeight+4},t.fontSize));
          });
        } else {
          if ((wrapping || placement?.copy) && staticTextWidth(row.text)*t.fontSize>available) fail('TEXT_WRAP_REQUIRED','$.textLayouts','Text does not fit one line; enable wrapping or shorten it');
          rowChildren.push(text(id, row.text, { x: controlX, y: placement?.copy ? placement.copyTextY : (rowHeight - textHeight) / 2, width: available, height: textHeight }, t.fontSize));
        }
      } else {
        const controlHeight = placement?.controlHeight ?? (adaptive && row.kind === 'button' ? 44 : 40), controlY = (rowHeight - controlHeight) / 2;
        if (available < (placement?.explicitAction ? 44 : 120)) fail('CONTROL_WIDTH', '$.layout.labelWidth', 'Select and Button need at least 120 logical pixels');
        if (controlY < 0 || controlHeight < t.fontSize * 1.3) fail('CONTROL_HEIGHT', '$.layout.rowHeight', 'Select and Button use a 40px control with a fitting text line');
        const rect = { x: controlX, y: controlY, width: available, height: controlHeight };
        if (row.kind === 'select') {
          // The sibling renderer opens an overlay below the field with a 2px gap.
          // Its default menu uses one max(32, fieldHeight) row per option and never flips.
          const pageFlow = spec.tabs ? flow.pages.find(page => page.id === place.pageId) : null;
          const popupBottom = (flow ? flow.panelY + flow.body.y + (pageFlow ? flow.pageY : 0) : (spec.canvas.height - panelHeight) / 2) + sectionY + rowY + controlY
            + controlHeight + 2 + Math.max(32, controlHeight) * field.options.length;
          if (!(pageFlow ? pageFlow.contentHeight > pageFlow.viewportHeight : flow?.scrollable) && popupBottom > spec.canvas.height) fail('SELECT_POPUP_OVERFLOW', '$.canvas.height', 'The open Select menu must fit below its field within the canvas');
          const skinTokens = { ...t, text: contrast(t.text,t.control) >= 4.5 ? t.text : buttonForeground(t.control) };
          const skinBorder = contrast(t.border,t.control) >= 3 ? t.border : contrast(t.accent,t.control) >= 3 ? t.accent : skinTokens.text;
          const skin = semantic ? selectSkin(rect,field.options.length,skinTokens,skinBorder,appearance?.controlRadius ?? 8) : null;
          for (const resource of skin?.resources ?? []) generatedResources.set(resource.path,resource);
          rowChildren.push(node(id, 'Select', rect, {
            selectedId: choiceId(spec.id, row.id, state[row.bind]),
            options: field.options.map(option => ({ id: choiceId(spec.id, row.id, option.id), label: option.label })),
            enabled: row.enabled,
            ...(skin ? { appearance: skin.appearance } : {}),
            // The default runtime popup is white/light green. An explicit light-field
            // palette keeps text legible there and in the collapsed field, including dark themes.
            style: semantic ? style(t.control,{textColor:skinTokens.text,borderColor:skinBorder,borderWidth:1,cornerRadius:appearance?.controlRadius ?? 8})
              : themed ? style(navigation.background, { textColor: navigation.text, borderColor: navigation.accent, borderWidth: 1, cornerRadius: appearance?.controlRadius ?? 8 })
              : modern ? style(t.surface, { borderColor: t.accent, borderWidth: 1, cornerRadius: 8 })
              : style('#F1F5FC', { textColor: '#111622', borderWidth: 1, cornerRadius: 6 }),
          }));
        } else {
          const buttonStyle = modern && (placement?.buttonRole === 'secondary' || (!placement?.buttonRole && row.action.kind === 'reset-initial'))
            ? style(t.surface, { textColor: t.accent, borderColor: t.accent, borderWidth: 1, fontWeight: 'bold', cornerRadius: 8 })
            : style(t.accent, { textColor: buttonForeground(t.accent), fontWeight: 'bold', cornerRadius: modern ? 8 : 6 });
          const role = semantic ? resolveRecipe(catalog,row.recipe,'button-row').buttonRole : undefined;
          if (role === 'secondary') Object.assign(buttonStyle,{backgroundColor:t.control,textColor:contrast(t.text,t.control)>=4.5?t.text:buttonForeground(t.control),borderColor:t.accent,borderWidth:1});
          if (role === 'primary' || role === 'danger') { const color = role === 'danger' ? '#C42B43' : t.accent; Object.assign(buttonStyle,{backgroundColor:color,textColor:buttonForeground(color),borderWidth:0}); }
          if (appearance?.buttonColor != null) {
            buttonStyle.backgroundColor = appearance.buttonColor;
            buttonStyle.textColor = buttonForeground(appearance.buttonColor);
          }
          if (appearance?.buttonTextColor != null) buttonStyle.textColor = appearance.buttonTextColor;
          if (appearance?.buttonRadius != null) buttonStyle.cornerRadius = appearance.buttonRadius;
          const localStyle = spec.buttonStyles?.find(value => value.rowId === row.id)?.style;
          if (localStyle?.backgroundColor != null) { buttonStyle.backgroundColor = localStyle.backgroundColor; buttonStyle.textColor = buttonForeground(localStyle.backgroundColor); }
          for (const key of ['textColor','borderColor','borderWidth','cornerRadius']) if (localStyle?.[key] != null) buttonStyle[key] = localStyle[key];
          if (placement?.circle) buttonStyle.cornerRadius = controlHeight / 2;
          const labelSize = buttonFontSize(spec, row.id, t.fontSize), labelHeight = Math.ceil(labelSize * 1.3);
          buttonStyle.fontSize = labelSize;
          if (typography && (labelHeight + 8 > controlHeight || presentationTextWidth(row.buttonLabel, labelSize) + 16 > available)) fail('BUTTON_FONT_FIT', '$.buttonFonts', 'Button text does not fit; reduce its font size or explicitly request a larger button');
          // An explicit Text child suppresses the component's implicit left label.
          // Pixi aligns this child using measured glyph bounds in panel-visuals;
          // Unity uses its existing native centered label instead.
          const labels = modern ? [node(`${id}.center-label`, 'Text', { x: 8, y: (controlHeight - labelHeight) / 2, width: available - 16, height: labelHeight }, {
            text: row.buttonLabel, wrap: 'none', overflow: adaptive ? 'error' : 'ellipsis', lineHeight: labelHeight, drawBackground: false, style: buttonStyle,
          })] : [];
          rowChildren.push(node(id, 'Button', rect, {
            label: row.buttonLabel, enabled: buttonEnabled(spec, row, state),
            style: buttonStyle,
          }, labels));
          actions.push({ nodeId: id, rowId: row.id, event: row.event, enabled: row.enabled, action: row.action });
        }
      }
      if (Object.hasOwn(row, 'bind')) bindings.push(row.kind === 'progress'
        ? { nodeId: id, fieldId: row.bind, type: 'progress', readOnly: true }
        : { nodeId: id, fieldId: row.bind, event: row.event, type: field.type, enabled: row.enabled });
      if (fullButton && [FLOW_PANEL_COMPILER_VERSION, PROGRESS_PANEL_COMPILER_VERSION, LEGACY_PROGRESS_PANEL_COMPILER_VERSION, TABS_PANEL_COMPILER_VERSION, FORMS_PANEL_COMPILER_VERSION, MODERN_PANEL_COMPILER_VERSION, THEMED_PANEL_COMPILER_VERSION, ADAPTIVE_PANEL_COMPILER_VERSION, APPEARANCE_PANEL_COMPILER_VERSION, ACTION_LAYOUT_PANEL_COMPILER_VERSION, BUTTON_STYLE_PANEL_COMPILER_VERSION, BUTTON_FONT_PANEL_COMPILER_VERSION, TITLE_BAR_PANEL_COMPILER_VERSION, TEXT_WRAP_PANEL_COMPILER_VERSION, FRAME_PANEL_COMPILER_VERSION, SEMANTIC_PANEL_COMPILER_VERSION, FOCUSED_PANEL_COMPILER_VERSION, NAVIGATION_PANEL_COMPILER_VERSION].includes(compilerVersion)) {
        // Container always paints in the shared contract. Emit the standalone button
        // (and optional icon) directly, preserving its ID and absolute geometry.
        for (const child of rowChildren) {
          layouts[child.id] = { ...layouts[child.id], y: layouts[child.id].y + rowY };
          sectionChildren.push(child);
        }
      } else sectionChildren.push(node(rowId, 'Container', {
        x: 0, y: rowY, width: contentWidth, height: rowHeight,
      }, { style: style(stacked || (modern && row.kind === 'text') ? t.surface : t.control, { ...(modern ? { cornerRadius: appearance?.controlRadius ?? 8 } : {}) }) }, rowChildren));
    }
    bodyChildren.push(node(sectionId, 'Container', { x: place?.x ?? l.padding, y: sectionY, width: contentWidth, height },
      { style: style(t.surface) }, sectionChildren));
    legacySectionY += height + l.sectionGap;
  }
  if (spec.tabs) {
    const tabs = spec.tabs, id = controlId(spec.id, tabs.id);
    select(tabs.recipe, 'tabs', flow.body.width, flow.body.height);
    if (tabs.pages.some(page => [...page.label].length * t.fontSize * 1.1 + 24 > flow.body.width / tabs.pages.length)) fail('TABS_LABEL_WIDTH', '$.tabs.pages', 'Tab labels must fit without shrinking');
    const pages = flow.pages.map(page => {
      const ownSections = bodyChildren.filter(child => tabs.pages.find(p => p.id === page.id).sections.some(section => child.id === `${spec.id}.section.${section}`));
      const scrollable = page.contentHeight > page.viewportHeight;
      return node(tabPageId(spec.id, page.id), scrollable ? 'ScrollView' : 'Container',
        { x: 0, y: flow.pageY, width: page.body.width, height: page.viewportHeight },
        scrollable ? { scrollX: 0, scrollY: 0, contentWidth: page.body.width, contentHeight: page.contentHeight,
          drawBackground: false, scrollbarVisibility: 'auto', style: style(t.surface) } : { style: style(t.surface) }, ownSections);
    });
    const skin = theme.navigationStyle === 'tabs-v1' ? tabsSkin(flow.body,tabs.pages.length,t,flow.headerHeight) : null;
    for (const resource of skin?.resources ?? []) generatedResources.set(resource.path,resource);
    children.push(node(id, 'Tabs', flow.body, { activeId: choiceId(spec.id, tabs.id, state[tabs.bind]), enabled: tabs.enabled,
      ...(skin ? {appearance:skin.appearance} : {}),
      drawBackground: false, style: skin ? style(skin.palette.idle,{textColor:skin.palette.text,borderColor:skin.palette.focus})
        : themed ? style(navigation.background, { textColor: navigation.text, borderColor: navigation.accent }) : style(t.surface, { borderColor: t.accent }),
      tabs: tabs.pages.map(page => ({ id: choiceId(spec.id, tabs.id, page.id), label: page.label, contentId: tabPageId(spec.id, page.id) })) }, pages));
    bindings.push({ nodeId: id, fieldId: tabs.bind, type: 'enum', event: tabs.event });
  } else if (flow) children.push(node(`${spec.id}.body`, flow.scrollable ? 'ScrollView' : 'Container', flow.body,
    flow.scrollable ? { scrollX: 0, scrollY: 0, contentWidth: flow.body.width, contentHeight: flow.contentHeight,
      drawBackground: false, scrollbarVisibility: 'auto', style: style(t.surface) } : { style: style(t.surface) }, bodyChildren));
  const surface = assets.get(spec.assets?.panelSurface);
  if (surface && appearance?.panelColor == null && appearance?.panelRadius == null) {
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
  }, { style: style(t.surface, { borderWidth: 1, cornerRadius: appearance?.panelRadius ?? t.radius }) }, children);
  const root = node(`${spec.id}.canvas`, 'Container', { x: 0, y: 0, ...spec.canvas }, { style: style(t.background, { cornerRadius: 0 }) }, [card]);
  const intent = { intentVersion: '0.2', id: spec.id, root };
  const policy = { canvas: spec.canvas, layout: layouts, layoutSource: {
    kind: 'explicit', description: `Explicit rectangles produced by UI Panel compiler ${compilerVersion} from declared ${flowVersion ? 'flow container' : 'stack'} rules; not image measurements.`,
  } };
  const document = core.compileTree(intent, imageFacts, policy);
  if (textBindings.length) document.valueTextBindings = { version: '1.0', bindings: textBindings };
  return {
    document: core.validateDocument(document), intent, policy, bindings, state, ...(controls ? { actions } : {}),
    ...(semantic ? { resources: [...generatedResources.values()] } : {}),
    selection: { theme: { id: theme.id, version: theme.version }, recipes: [...selected.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) },
  };
}
