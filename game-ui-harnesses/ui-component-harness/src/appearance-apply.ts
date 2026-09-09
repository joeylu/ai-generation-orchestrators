import { HarnessError } from './contract.ts';
import { bundleResources, createBundle, validateBundle, type ResourceInput, type UiBundle } from './bundle.ts';
import { APPEARANCE_APPLICATION_BINDING_VERSION, validateAppearanceBinding, type AppearanceBindingDocument, type AppearanceComponentBinding, type AppearanceRole } from './appearance-binding.ts';
import { assertValidImportedDecomposition, type ImportedDecomposition, type ImportedDecompositionLayer } from './decomposition-import.ts';
import { walkNodes, type Layout, type UiDocument, type UiNode } from './tree-contract.ts';

type SupportedNode = Extract<UiNode, { type: 'Button' | 'Switch' | 'CheckBox' | 'RadioGroup' | 'Input' | 'Select' | 'ProgressBar' | 'Slider' | 'ScrollView' | 'List' | 'Dialog' | 'Tabs' }>;

function fail(path: string, code: string, message: string): never {
  throw new HarnessError('contract', [{ path, code, message }]);
}
function close(left: number, right: number): boolean { return Math.abs(left - right) <= 1e-6; }
function globalLayouts(document: UiDocument): Map<string, Layout> {
  const result = new Map<string, Layout>();
  const visit = (node: UiNode, parentX: number, parentY: number) => {
    const layout = { x: parentX + node.layout.x, y: parentY + node.layout.y, width: node.layout.width, height: node.layout.height };
    result.set(node.id, layout);
    if ('children' in node) node.children.forEach(child => visit(child, layout.x, layout.y));
  };
  visit(document.root, 0, 0); return result;
}
function transformed(layer: ImportedDecompositionLayer, binding: AppearanceBindingDocument): Layout {
  const { scale, offset } = binding.registration.transform;
  return { x: offset.x + layer.left * scale, y: offset.y + layer.top * scale, width: layer.width * scale, height: layer.height * scale };
}
function requireExactComponentLayer(path: string, layer: ImportedDecompositionLayer, component: Layout, binding: AppearanceBindingDocument): void {
  const actual = transformed(layer, binding);
  if (![actual.x - component.x, actual.y - component.y, actual.width - component.width, actual.height - component.height].every(value => Math.abs(value) <= 1e-6)) {
    fail(path, 'COMPONENT_LAYER_GEOMETRY_MISMATCH', 'the registered layer rectangle must exactly match the target component');
  }
}
function requireContained(path: string, layer: ImportedDecompositionLayer, component: Layout, binding: AppearanceBindingDocument): Layout {
  const actual = transformed(layer, binding);
  if (actual.x < component.x || actual.y < component.y || actual.x + actual.width > component.x + component.width || actual.y + actual.height > component.y + component.height) {
    fail(path, 'PART_LAYER_OUT_OF_BOUNDS', 'the registered part layer must fit within the target component');
  }
  return actual;
}
function localLayer(path: string, layer: ImportedDecompositionLayer, component: Layout, binding: AppearanceBindingDocument): Layout {
  const actual = requireContained(path, layer, component, binding);
  return { x: actual.x - component.x, y: actual.y - component.y, width: actual.width, height: actual.height };
}
function roles(binding: AppearanceComponentBinding, layers: ReadonlyMap<string, ImportedDecompositionLayer>, path: string): Map<AppearanceRole, ImportedDecompositionLayer> {
  const result = new Map<AppearanceRole, ImportedDecompositionLayer>();
  for (const part of binding.parts) {
    const layer = layers.get(part.layerId);
    if (!layer) fail(`${path}.parts`, 'UNKNOWN_LAYER', 'validated binding references a missing layer');
    result.set(part.role, layer);
  }
  return result;
}
function only(path: string, parts: ReadonlyMap<AppearanceRole, ImportedDecompositionLayer>, allowed: readonly AppearanceRole[]): void {
  for (const role of parts.keys()) if (!allowed.includes(role)) fail(path, 'RUNTIME_ROLE_UNSUPPORTED', `runtime application does not support role ${role}`);
}
function resourcePath(archiveSha256: string, layer: ImportedDecompositionLayer): string {
  return `appearance/${archiveSha256}/${layer.id}.png`;
}

/**
 * Deterministically compiles an authenticated appearance handoff into a
 * portable runtime bundle. It never selects components, roles, coordinates or
 * state values: every applied fact comes from the validated target, delivery,
 * registration or binding document.
 */
export async function applyAppearanceBinding(
  targetInput: unknown,
  importedInput: ImportedDecomposition,
  bindingInput: unknown,
): Promise<UiBundle> {
  const target = await validateBundle(targetInput);
  if (target.document.schemaVersion !== '0.2') fail('$target.document', 'UI_DOCUMENT_REQUIRED', 'appearance application requires a v0.2 UI document');
  const imported = await assertValidImportedDecomposition(importedInput);
  const binding = await validateAppearanceBinding(bindingInput, target.document, imported);
  if (binding.version !== APPEARANCE_APPLICATION_BINDING_VERSION) fail('$appearanceBinding.version', 'APPLICATION_BINDING_REQUIRED', 'runtime application requires appearance binding version 0.2');
  const document = structuredClone(target.document);
  const nodes = new Map(walkNodes(document).map(node => [node.id, node]));
  const bounds = globalLayouts(document);
  const sourceLayers = new Map(imported.scene.layers.map(layer => [layer.id, layer]));
  const sourceResources = new Map(imported.resources.map(resource => [resource.path, resource]));
  const additions = new Map<string, ResourceInput>();

  const add = (layer: ImportedDecompositionLayer): string => {
    const source = sourceResources.get(layer.path);
    if (!source) fail('$delivery.resources', 'BOUND_LAYER_RESOURCE_MISSING', `missing bytes for layer ${layer.id}`);
    const path = resourcePath(imported.archiveSha256, layer);
    if (!additions.has(path)) additions.set(path, { path, mime: 'image/png', bytes: new Uint8Array(source.bytes) });
    return path;
  };

  for (const [index, componentBinding] of binding.bindings.entries()) {
    const path = `$appearanceBinding.bindings[${index}]`;
    const node = nodes.get(componentBinding.componentId);
    const component = bounds.get(componentBinding.componentId);
    if (!node || !component) fail(`${path}.componentId`, 'UNKNOWN_COMPONENT', 'target component is missing');
    if (!['Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs'].includes(node.type)) {
      fail(`${path}.componentType`, 'RUNTIME_COMPONENT_UNSUPPORTED', `runtime application does not support ${node.type}`);
    }
    const partLayers = roles(componentBinding, sourceLayers, path);
    if (node.type === 'Image') {
      only(`${path}.parts`, partLayers, ['image']);
      const image = partLayers.get('image')!;
      requireExactComponentLayer(`${path}.parts`, image, component, binding);
      if (node.props.region) fail(`${path}.componentId`, 'IMAGE_REGION_CONFLICT', 'automatic appearance cannot replace a cropped Image source');
      node.props.source = add(image);
      node.props.fit = 'stretch';
      node.props.drawBackground = false;
      continue;
    }
    if (node.type === 'Text') {
      // The imported text pixels are evidence for the target rectangle only.
      // Semantic text, style and optional font source remain authoritative.
      only(`${path}.parts`, partLayers, ['text']);
      requireExactComponentLayer(`${path}.parts`, partLayers.get('text')!, component, binding);
      continue;
    }
    if (node.type === 'Container') {
      if (node.props.appearance) fail(`${path}.componentId`, 'EXISTING_APPEARANCE', 'automatic application never overwrites an existing runtime appearance');
      only(`${path}.parts`, partLayers, ['background']);
      const background = partLayers.get('background')!;
      requireExactComponentLayer(`${path}.parts`, background, component, binding);
      const scale = component.width / background.width;
      if (!close(component.height / background.height, scale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'Container background must scale uniformly into the component');
      node.props.appearance = {
        sourceCanvas: { width: background.width, height: background.height },
        background: { image: add(background), canvas: { width: background.width, height: background.height }, layout: { x: 0, y: 0, width: background.width, height: background.height } },
      };
      continue;
    }
    if (node.type === 'Panel') {
      if (node.props.appearance) fail(`${path}.componentId`, 'EXISTING_APPEARANCE', 'automatic application never overwrites an existing runtime appearance');
      only(`${path}.parts`, partLayers, ['background', 'header', 'body']);
      const background = partLayers.get('background')!, header = partLayers.get('header')!, body = partLayers.get('body');
      requireExactComponentLayer(`${path}.parts`, background, component, binding);
      const headerLayout = localLayer(`${path}.parts`, header, component, binding);
      const bodyLayout = body ? localLayer(`${path}.parts`, body, component, binding) : undefined;
      const state = componentBinding.states && 'panel' in componentBinding.states ? componentBinding.states.panel : undefined;
      if (!state) fail(`${path}.states`, 'PANEL_STATE_REQUIRED', 'explicit Panel title geometry is required');
      const scale = component.width / background.width;
      if (!close(component.height / background.height, scale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'Panel background must scale uniformly into the component');
      const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      node.props.appearance = {
        sourceCanvas: { width: background.width, height: background.height },
        background: { image: add(background), canvas: { width: background.width, height: background.height }, layout: { x: 0, y: 0, width: background.width, height: background.height } },
        header: { image: add(header), canvas: { width: header.width, height: header.height }, layout: local(headerLayout) },
        ...(body && bodyLayout ? { body: { image: add(body), canvas: { width: body.width, height: body.height }, layout: local(bodyLayout) } } : {}),
        titleLayout: local(state.titleLayout),
      };
      continue;
    }
    const supported = node as SupportedNode;
    if (supported.props.appearance || (supported.type === 'Button' && supported.props.backgroundImage)) {
      fail(`${path}.componentId`, 'EXISTING_APPEARANCE', 'automatic application never overwrites an existing runtime appearance');
    }
    if (supported.type === 'Button') {
      only(`${path}.parts`, partLayers, ['background']);
      const background = partLayers.get('background')!;
      requireExactComponentLayer(`${path}.parts`, background, component, binding);
      if (supported.children.some(child => child.type === 'Text')) fail(`${path}.componentId`, 'BUTTON_TEXT_CHILD_CONFLICT', 'semantic raster Button labels cannot coexist with Text children');
      const state = componentBinding.states && 'button' in componentBinding.states ? componentBinding.states.button : undefined;
      if (!state) fail(`${path}.states`, 'BUTTON_STATE_REQUIRED', 'explicit Button label layout is required');
      const runtimeScale = component.width / background.width;
      supported.props.appearance = {
        backgroundImage: add(background), sourceCanvas: { width: background.width, height: background.height },
        labelLayout: { x: state.labelLayout.x / runtimeScale, y: state.labelLayout.y / runtimeScale, width: state.labelLayout.width / runtimeScale, height: state.labelLayout.height / runtimeScale },
      };
      continue;
    }
    if (supported.type === 'Switch') {
      only(`${path}.parts`, partLayers, ['track', 'thumb']);
      const track = partLayers.get('track')!, thumb = partLayers.get('thumb')!;
      requireExactComponentLayer(`${path}.parts`, track, component, binding);
      requireContained(`${path}.parts`, thumb, component, binding);
      const switchState = componentBinding.states && 'switch' in componentBinding.states ? componentBinding.states.switch : undefined;
      const positions = switchState?.thumbPositions;
      if (!positions) fail(`${path}.states`, 'SWITCH_STATE_REQUIRED', 'explicit Switch state positions are required');
      const runtimeScale = component.width / track.width;
      supported.props.appearance = {
        trackImage: add(track), thumbImage: add(thumb), sourceCanvas: { width: track.width, height: track.height },
        thumbPositions: {
          off: { x: positions.off.x / runtimeScale, y: positions.off.y / runtimeScale },
          on: { x: positions.on.x / runtimeScale, y: positions.on.y / runtimeScale },
        },
        ...(switchState?.labelLayout ? { labelLayout: {
          x: switchState.labelLayout.x / runtimeScale, y: switchState.labelLayout.y / runtimeScale,
          width: switchState.labelLayout.width / runtimeScale, height: switchState.labelLayout.height / runtimeScale,
        } } : {}),
      };
      continue;
    }
    if (supported.type === 'CheckBox') {
      only(`${path}.parts`, partLayers, ['box', 'mark']); const box = partLayers.get('box')!, mark = partLayers.get('mark')!;
      const boxLayout = localLayer(`${path}.parts`, box, component, binding), markLayout = localLayer(`${path}.parts`, mark, component, binding);
      const state = componentBinding.states && 'checkBox' in componentBinding.states ? componentBinding.states.checkBox : undefined;
      if (!state) fail(`${path}.states`, 'CHECKBOX_STATE_REQUIRED', 'explicit CheckBox label geometry is required');
      const scale = binding.registration.transform.scale, local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: component.width / scale, height: component.height / scale }, box: { image: add(box), canvas: { width: box.width, height: box.height }, layout: local(boxLayout) }, mark: { image: add(mark), canvas: { width: mark.width, height: mark.height }, layout: local(markLayout) }, labelLayout: local(state.labelLayout) };
      continue;
    }
    if (supported.type === 'RadioGroup') {
      const allowed = new Set(['option', 'indicator']); for (const part of componentBinding.parts) if (!allowed.has(part.role)) fail(`${path}.parts`, 'RUNTIME_ROLE_UNSUPPORTED', `runtime application does not support role ${part.role}`);
      const scale = binding.registration.transform.scale, state = componentBinding.states && 'radioGroup' in componentBinding.states ? componentBinding.states.radioGroup : undefined;
      if (!state) fail(`${path}.states`, 'RADIO_STATE_REQUIRED', 'explicit RadioGroup option geometry is required');
      const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: component.width / scale, height: component.height / scale }, items: supported.props.options.map(option => {
        const optionPart = componentBinding.parts.find(part => part.role === 'option' && part.optionId === option.id), indicatorPart = componentBinding.parts.find(part => part.role === 'indicator' && part.optionId === option.id), geometry = state.options.find(item => item.optionId === option.id);
        if (!optionPart || !indicatorPart || !geometry) fail(`${path}.parts`, 'RADIO_OPTION_INCOMPLETE', `missing explicit appearance for option ${option.id}`);
        const optionLayer = sourceLayers.get(optionPart.layerId)!, indicatorLayer = sourceLayers.get(indicatorPart.layerId)!;
        return { optionId: option.id, option: { image: add(optionLayer), canvas: { width: optionLayer.width, height: optionLayer.height }, layout: local(localLayer(`${path}.parts`, optionLayer, component, binding)) }, indicator: { image: add(indicatorLayer), canvas: { width: indicatorLayer.width, height: indicatorLayer.height }, layout: local(localLayer(`${path}.parts`, indicatorLayer, component, binding)) }, hitArea: local(geometry.hitArea), labelLayout: local(geometry.labelLayout) };
      }) };
      continue;
    }
    if (supported.type === 'Input') {
      only(`${path}.parts`, partLayers, ['background']); const background = partLayers.get('background')!; requireExactComponentLayer(`${path}.parts`, background, component, binding);
      const state = componentBinding.states && 'input' in componentBinding.states ? componentBinding.states.input : undefined; if (!state) fail(`${path}.states`, 'INPUT_STATE_REQUIRED', 'explicit Input text geometry is required');
      const scale = component.width / background.width; if (!close(component.height / background.height, scale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'Input background must scale uniformly into the component');
      const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { backgroundImage: add(background), sourceCanvas: { width: background.width, height: background.height }, textLayout: local(state.textLayout), placeholderLayout: local(state.placeholderLayout) };
      continue;
    }
    if (supported.type === 'ProgressBar') {
      only(`${path}.parts`, partLayers, ['track', 'fill']); const track = partLayers.get('track')!, fill = partLayers.get('fill')!; requireExactComponentLayer(`${path}.parts`, track, component, binding);
      const fillLayout = localLayer(`${path}.parts`, fill, component, binding), state = componentBinding.states && 'progressBar' in componentBinding.states ? componentBinding.states.progressBar : undefined;
      if (!state) fail(`${path}.states`, 'PROGRESS_STATE_REQUIRED', 'explicit ProgressBar fill clipping geometry is required');
      if (![fillLayout.x - state.fillClip.x, fillLayout.y - state.fillClip.y, fillLayout.width - state.fillClip.width, fillLayout.height - state.fillClip.height].every(close.bind(null, 0))) fail(`${path}.states`, 'FILL_CLIP_GEOMETRY_MISMATCH', 'full fill layer must exactly match the declared fill clip');
      const scale = component.width / track.width; if (!close(component.height / track.height, scale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'ProgressBar track must scale uniformly into the component'); const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: track.width, height: track.height }, track: { image: add(track), canvas: { width: track.width, height: track.height }, layout: { x: 0, y: 0, width: track.width, height: track.height } }, fill: { image: add(fill), canvas: { width: fill.width, height: fill.height }, layout: local(fillLayout) }, fillClip: local(state.fillClip), fillDirection: 'left-to-right', fillSource: 'full-range-template' };
      continue;
    }
    if (supported.type === 'Slider') {
      only(`${path}.parts`, partLayers, ['track', 'fill', 'thumb']); const track = partLayers.get('track')!, fill = partLayers.get('fill')!, thumb = partLayers.get('thumb')!;
      const trackLayout = localLayer(`${path}.parts`, track, component, binding), fillLayout = localLayer(`${path}.parts`, fill, component, binding); requireContained(`${path}.parts`, thumb, component, binding);
      const state = componentBinding.states && 'slider' in componentBinding.states ? componentBinding.states.slider : undefined; if (!state) fail(`${path}.states`, 'SLIDER_STATE_REQUIRED', 'explicit Slider fill and endpoint geometry is required');
      if (![fillLayout.x - state.fillClip.x, fillLayout.y - state.fillClip.y, fillLayout.width - state.fillClip.width, fillLayout.height - state.fillClip.height].every(close.bind(null, 0))) fail(`${path}.states`, 'FILL_CLIP_GEOMETRY_MISMATCH', 'full fill layer must exactly match the declared fill clip');
      const ratio = (supported.props.value - supported.props.min) / (supported.props.max - supported.props.min), expected = { x: state.thumbPositions.min.x + (state.thumbPositions.max.x - state.thumbPositions.min.x) * ratio, y: state.thumbPositions.min.y + (state.thumbPositions.max.y - state.thumbPositions.min.y) * ratio }, actualThumb = localLayer(`${path}.parts`, thumb, component, binding);
      if (!close(actualThumb.x, expected.x) || !close(actualThumb.y, expected.y)) fail(`${path}.states`, 'SLIDER_VALUE_GEOMETRY_MISMATCH', 'imported thumb position must match the target Slider value and declared endpoints');
      const scale = binding.registration.transform.scale, local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: component.width / scale, height: component.height / scale }, track: { image: add(track), canvas: { width: track.width, height: track.height }, layout: local(trackLayout) }, fill: { image: add(fill), canvas: { width: fill.width, height: fill.height }, layout: local(fillLayout) }, fillClip: local(state.fillClip), fillDirection: 'left-to-right', fillSource: 'full-range-template', thumbImage: add(thumb), thumbCanvas: { width: thumb.width, height: thumb.height }, thumbPositions: { min: { x: state.thumbPositions.min.x / scale, y: state.thumbPositions.min.y / scale }, max: { x: state.thumbPositions.max.x / scale, y: state.thumbPositions.max.y / scale } } };
      continue;
    }
    if (supported.type === 'ScrollView') {
      only(`${path}.parts`, partLayers, ['viewport', 'scrollbar-track', 'scrollbar-thumb']);
      const viewport = partLayers.get('viewport')!, track = partLayers.get('scrollbar-track')!, thumb = partLayers.get('scrollbar-thumb')!;
      requireExactComponentLayer(`${path}.parts`, viewport, component, binding);
      const trackLayout = localLayer(`${path}.parts`, track, component, binding), actualThumb = localLayer(`${path}.parts`, thumb, component, binding);
      const state = componentBinding.states && 'scrollView' in componentBinding.states ? componentBinding.states.scrollView : undefined;
      if (!state) fail(`${path}.states`, 'SCROLL_STATE_REQUIRED', 'explicit scrollbar endpoint geometry is required');
      const ratio = supported.props.scrollY / (supported.props.contentHeight - component.height);
      const expected = { x: state.thumbPositions.min.x, y: state.thumbPositions.min.y + (state.thumbPositions.max.y - state.thumbPositions.min.y) * ratio };
      if (!close(actualThumb.x, expected.x) || !close(actualThumb.y, expected.y)) fail(`${path}.states`, 'SCROLL_VALUE_GEOMETRY_MISMATCH', 'imported thumb position must match scrollY and the declared endpoints');
      const scale = component.width / viewport.width;
      if (!close(component.height / viewport.height, scale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'ScrollView viewport must scale uniformly into the component');
      const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: viewport.width, height: viewport.height }, viewport: { image: add(viewport), canvas: { width: viewport.width, height: viewport.height }, layout: { x: 0, y: 0, width: viewport.width, height: viewport.height } }, scrollbarTrack: { image: add(track), canvas: { width: track.width, height: track.height }, layout: local(trackLayout) }, scrollbarThumbImage: add(thumb), scrollbarThumbCanvas: { width: thumb.width, height: thumb.height }, scrollbarThumbPositions: { min: { x: state.thumbPositions.min.x / scale, y: state.thumbPositions.min.y / scale }, max: { x: state.thumbPositions.max.x / scale, y: state.thumbPositions.max.y / scale } } };
      continue;
    }
    if (supported.type === 'List') {
      only(`${path}.parts`, partLayers, ['background', 'row', 'selected-row']);
      const background = partLayers.get('background')!, row = partLayers.get('row')!, selected = partLayers.get('selected-row')!;
      requireExactComponentLayer(`${path}.parts`, background, component, binding);
      const state = componentBinding.states && 'list' in componentBinding.states ? componentBinding.states.list : undefined;
      if (!state) fail(`${path}.states`, 'LIST_STATE_REQUIRED', 'explicit repeated row geometry is required');
      const checkSample = (role: 'row' | 'selected-row', layer: ImportedDecompositionLayer) => {
        const itemId = componentBinding.parts.find(part => part.role === role)?.itemId;
        const index = supported.props.items.findIndex(item => item.id === itemId);
        const actual = transformed(layer, binding);
        if (index < 0 || !close(actual.x, component.x) || !close(actual.y, component.y + index * supported.props.itemHeight) || !close(actual.width, component.width) || !close(actual.height, supported.props.itemHeight)) fail(`${path}.parts`, 'LIST_SAMPLE_GEOMETRY_MISMATCH', `${role} must exactly match its declared item row`);
      };
      checkSample('row', row); checkSample('selected-row', selected);
      const scale = component.width / background.width;
      if (!close(component.height / background.height, scale) || !close(component.width / row.width, scale) || !close(component.width / selected.width, scale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'List background and row templates must use one uniform runtime scale');
      const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: background.width, height: background.height }, backgroundImage: add(background), rowImage: add(row), rowCanvas: { width: row.width, height: row.height }, selectedRowImage: add(selected), selectedRowCanvas: { width: selected.width, height: selected.height }, labelLayout: local(state.labelLayout), hitArea: local(state.hitArea) };
      continue;
    }
    if (supported.type === 'Dialog') {
      only(`${path}.parts`, partLayers, ['background', 'header', 'body', 'overlay']);
      const background = partLayers.get('background')!, header = partLayers.get('header')!, body = partLayers.get('body')!, overlay = partLayers.get('overlay');
      requireExactComponentLayer(`${path}.parts`, background, component, binding);
      const headerLayout = localLayer(`${path}.parts`, header, component, binding), bodyLayout = localLayer(`${path}.parts`, body, component, binding);
      const state = componentBinding.states && 'dialog' in componentBinding.states ? componentBinding.states.dialog : undefined;
      if (!state) fail(`${path}.states`, 'DIALOG_STATE_REQUIRED', 'explicit Dialog title geometry is required');
      if (overlay) { const actual = transformed(overlay, binding); if (!close(actual.x, 0) || !close(actual.y, 0) || !close(actual.width, document.canvas.width) || !close(actual.height, document.canvas.height)) fail(`${path}.parts`, 'OVERLAY_CANVAS_MISMATCH', 'modal overlay must exactly match the target document canvas'); }
      const scale = component.width / background.width;
      if (!close(component.height / background.height, scale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'Dialog background must scale uniformly into the component');
      const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: background.width, height: background.height }, background: { image: add(background), canvas: { width: background.width, height: background.height }, layout: { x: 0, y: 0, width: background.width, height: background.height } }, header: { image: add(header), canvas: { width: header.width, height: header.height }, layout: local(headerLayout) }, body: { image: add(body), canvas: { width: body.width, height: body.height }, layout: local(bodyLayout) }, ...(overlay ? { overlayImage: add(overlay), overlayCanvas: { width: overlay.width, height: overlay.height } } : {}), titleLayout: local(state.titleLayout) };
      continue;
    }
    if (supported.type === 'Tabs') {
      only(`${path}.parts`, partLayers, ['tab', 'active-tab']);
      const tab = partLayers.get('tab')!, active = partLayers.get('active-tab')!;
      const state = componentBinding.states && 'tabs' in componentBinding.states ? componentBinding.states.tabs : undefined;
      if (!state) fail(`${path}.states`, 'TABS_STATE_REQUIRED', 'explicit repeated tab geometry is required');
      const tabWidth = component.width / supported.props.tabs.length;
      const checkSample = (role: 'tab' | 'active-tab', layer: ImportedDecompositionLayer) => {
        const tabId = componentBinding.parts.find(part => part.role === role)?.tabId;
        const index = supported.props.tabs.findIndex(item => item.id === tabId);
        const actual = transformed(layer, binding);
        if (index < 0 || !close(actual.x, component.x + index * tabWidth) || !close(actual.y, component.y) || !close(actual.width, tabWidth) || !close(actual.height, state.headerHeight)) fail(`${path}.parts`, 'TAB_SAMPLE_GEOMETRY_MISMATCH', `${role} must exactly match its declared tab header cell`);
      };
      checkSample('tab', tab); checkSample('active-tab', active);
      const scale = binding.registration.transform.scale;
      if (!close(tab.width * scale, tabWidth) || !close(active.width * scale, tabWidth) || !close(tab.height * scale, state.headerHeight) || !close(active.height * scale, state.headerHeight)) fail(`${path}.parts`, 'TAB_TEMPLATE_SCALE_MISMATCH', 'tab templates must share the registered uniform scale');
      const local = (layout: Layout): Layout => ({ x: layout.x / scale, y: layout.y / scale, width: layout.width / scale, height: layout.height / scale });
      supported.props.appearance = { sourceCanvas: { width: component.width / scale, height: component.height / scale }, tabImage: add(tab), tabCanvas: { width: tab.width, height: tab.height }, activeTabImage: add(active), activeTabCanvas: { width: active.width, height: active.height }, headerHeight: state.headerHeight / scale, labelLayout: local(state.labelLayout), hitArea: local(state.hitArea) };
      continue;
    }
    only(`${path}.parts`, partLayers, ['background', 'indicator', 'popup']);
    const field = partLayers.get('background')!, indicator = partLayers.get('indicator')!;
    const popup = partLayers.get('popup');
    if (!popup) fail(`${path}.parts`, 'SELECT_POPUP_LAYER_REQUIRED', 'Select runtime application requires an explicit option layer for the popup surface');
    requireExactComponentLayer(`${path}.parts`, field, component, binding);
    const indicatorBounds = requireContained(`${path}.parts`, indicator, component, binding);
    const state = componentBinding.states && 'select' in componentBinding.states ? componentBinding.states.select : undefined;
    if (!state) fail(`${path}.states`, 'SELECT_STATE_REQUIRED', 'explicit Select label and popup placement are required');
    const popupBounds = transformed(popup, binding);
    const expectedPopupY = component.y + component.height + state.popupPlacement.gap;
    if (!close(popupBounds.x, component.x) || !close(popupBounds.y, expectedPopupY) || !close(popupBounds.width, component.width)) {
      fail(`${path}.parts`, 'SELECT_POPUP_GEOMETRY_MISMATCH', 'registered popup must use the declared below-start placement and component width');
    }
    const runtimeScale = component.width / field.width;
    if (!close(component.height / field.height, runtimeScale)) fail(`${path}.parts`, 'NON_UNIFORM_COMPONENT_SCALE', 'Select field must scale uniformly into the component');
    const local = (layout: Layout): Layout => ({ x: layout.x / runtimeScale, y: layout.y / runtimeScale, width: layout.width / runtimeScale, height: layout.height / runtimeScale });
    supported.props.appearance = {
      fieldImage: add(field), arrowImage: add(indicator), popupImage: add(popup),
      sourceCanvas: { width: field.width, height: field.height }, labelLayout: local(state.labelLayout),
      arrowLayout: { x: (indicatorBounds.x - component.x) / runtimeScale, y: (indicatorBounds.y - component.y) / runtimeScale, width: indicatorBounds.width / runtimeScale, height: indicatorBounds.height / runtimeScale },
      popupCanvas: { width: popup.width, height: popup.height }, popupGap: state.popupPlacement.gap,
    };
  }

  const existing = bundleResources(target);
  const existingPaths = new Set(existing.map(resource => resource.path));
  for (const path of additions.keys()) if (existingPaths.has(path)) fail('$target.resources', 'APPEARANCE_RESOURCE_COLLISION', `target already contains ${path}`);
  return createBundle(document, [...existing, ...additions.values()], {
    kind: target.provenance.kind,
    description: `${target.provenance.description} Applied authenticated appearance binding ${imported.archiveSha256.slice(0, 16)} with ${binding.bindings.length} explicit component mapping(s).`,
  }, target.motion, target.motionSystem);
}
