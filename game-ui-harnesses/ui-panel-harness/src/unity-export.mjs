import { validatePanelBundle } from './panel-bundle.mjs';
import { controlId } from './compiler.mjs';

export const UNITY_ADAPTER_VERSION = '0.1.2';
const supported = new Set(['Container', 'Text', 'Image', 'Slider', 'Switch', 'Select', 'Button', 'ProgressBar', 'ScrollView']);
const fail = code => { const error = new Error(code); error.code = code; throw error; };

/** Native target lowering from a recompiled bundle; source capabilities remain unchanged. */
export async function createUnityDocument(input, core) {
  const bundle = await validatePanelBundle(input, core), spec = bundle.spec;
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(spec.id)) fail('UNITY_PANEL_ID_RESERVED');
  for (const row of spec.sections.flatMap(section => section.rows)) {
    if (row.kind === 'progress' && row.format.mode === 'value' && spec.state.find(field => field.id === row.bind).max >= 1e21) fail('UNITY_PROGRESS_FORMAT_LIMIT');
  }
  const fields = spec.state.map(field => {
    if (field.type === 'number') {
      const ticks = Math.round((field.max - field.min) / field.step);
      if (ticks < 1 || ticks > 1_000_000) fail('UNITY_SLIDER_PRECISION_LIMIT');
      for (let tick = 0; tick <= ticks; tick += 1) {
        const value = tick === ticks ? field.max : field.min + tick * field.step;
        const back = (value - field.min) / field.step;
        const tolerance = Math.min(1e-7, 16 * Number.EPSILON * Math.max(1, Math.abs(back)));
        if (!Number.isFinite(value) || Math.abs(back - tick) > tolerance) fail('UNITY_NUMBER_PRECISION');
      }
    }
    return {
      id: field.id, type: field.type,
      min: field.min ?? 0, max: field.max ?? 0, step: field.step ?? 0,
      initialNumber: ['number', 'progress'].includes(field.type) ? field.initial : 0,
      numberValue: ['number', 'progress'].includes(field.type) ? bundle.state[field.id] : 0,
      initialBoolean: field.type === 'boolean' ? field.initial : false,
      booleanValue: field.type === 'boolean' ? bundle.state[field.id] : false,
      initialString: field.type === 'enum' ? field.initial : '',
      stringValue: field.type === 'enum' ? bundle.state[field.id] : '',
      options: structuredClone(field.options ?? []),
    };
  });
  const controls = spec.sections.flatMap(section => section.rows).filter(row => row.kind !== 'text').map(row => ({
    nodeId: controlId(spec.id, row.id), rowId: row.id, kind: row.kind, fieldId: row.bind ?? '',
    eventName: row.event ?? '', enabled: row.enabled ?? false, action: row.action?.kind ?? '',
    resetFields: [...(row.action?.fields ?? [])], valueTextId: ['slider', 'progress'].includes(row.kind) ? `${spec.id}.row.${row.id}.value` : '',
    prefix: row.format?.prefix ?? '', suffix: row.format?.suffix ?? '', fractionDigits: row.format?.fractionDigits ?? 0,
    ...(row.kind === 'progress' ? { displayMode: row.format.mode } : {}),
  }));
  const nodes = [];
  function visit(node, parentId) {
    if (!supported.has(node.type)) fail('UNITY_COMPONENT_UNSUPPORTED');
    const p = node.props, s = p.style, region = p.region;
    // Reject float overflow rather than silently changing native geometry.
    for (const value of Object.values(node.layout)) if (!Number.isFinite(Math.fround(value))) fail('UNITY_GEOMETRY_PRECISION');
    nodes.push({
      id: node.id, parentId, type: node.type, ...node.layout,
      backgroundColor: s.backgroundColor, borderColor: s.borderColor, textColor: s.textColor,
      borderWidth: s.borderWidth, cornerRadius: s.cornerRadius, opacity: s.opacity,
      fontSize: s.fontSize, bold: s.fontWeight === 'bold', drawBackground: p.drawBackground ?? true,
      text: p.text ?? p.label ?? '', source: p.source ?? '', fit: p.fit ?? '',
      hasRegion: Boolean(region), regionX: region?.x ?? 0, regionY: region?.y ?? 0,
      regionWidth: region?.width ?? 0, regionHeight: region?.height ?? 0,
      contentWidth: p.contentWidth ?? 0, contentHeight: p.contentHeight ?? 0,
    });
    for (const child of node.children ?? []) visit(child, node.id);
  }
  visit(bundle.componentBundle.document.root, '');
  const records = new Map((bundle.assetClosure?.records ?? []).map(asset => [asset.sha256, asset]));
  const assets = bundle.componentBundle.resources.map(resource => {
    const record = records.get(resource.sha256);
    if (!record || resource.path !== `textures/${resource.sha256}.png`) fail('UNITY_ASSET_REFERENCE');
    return { path: resource.path, sha256: resource.sha256, bytes: record.bytes, width: record.width, height: record.height };
  });
  return {
    formatVersion: '0.1', adapterVersion: UNITY_ADAPTER_VERSION,
    panelId: spec.id, panelSha256: bundle.sha256, panelSpecVersion: spec.panelSpecVersion,
    canvasWidth: spec.canvas.width, canvasHeight: spec.canvas.height,
    nodes, fields, controls, assets,
  };
}
