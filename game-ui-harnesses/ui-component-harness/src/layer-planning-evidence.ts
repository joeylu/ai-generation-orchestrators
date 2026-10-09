/** Portable model planning evidence. Session IDs and transport receipts stay outside bundles. */
import { walkNodes, type UiDocument } from './tree-contract.ts';

export interface LayerPlanningFinding {
  componentId: string; pointer: string;
  basis: 'observed' | 'inferred' | 'explicit-policy'; note: string;
}
export interface LayerPlanningEvidence {
  version: '1.0'; referenceSha256: string; responseSha256: string;
  findings: LayerPlanningFinding[]; issues: string[];
}
export interface LayerMissingInput {
  subject: string; kind: 'unreadable-text' | 'unknown-value' | 'unknown-component'; detail: string;
}
export interface LayerPlanningDiagnostic {
  summary: string; issues: string[];
  reason?: 'construction-incomplete' | 'required-semantics-missing'; missingInputs?: LayerMissingInput[];
}
export function validateLayerPlanningDiagnostic(input: unknown): LayerPlanningDiagnostic {
  const structured = !!input && typeof input === 'object' && Object.hasOwn(input, 'reason');
  const row = record(input, ['summary', 'issues', ...(structured ? ['reason', 'missingInputs'] : [])]);
  if (!isPortableLayerPlanningNote(row.summary, 2000) || !Array.isArray(row.issues) || row.issues.length > 256
    || row.issues.some(issue => !isPortableLayerPlanningNote(issue, 1000))) fail();
  if (!structured) return { summary: row.summary, issues: [...row.issues] as string[] };
  if (!['construction-incomplete', 'required-semantics-missing'].includes(String(row.reason))
    || !Array.isArray(row.missingInputs) || row.missingInputs.length > 64) fail();
  const missingInputs = row.missingInputs.map(value => {
    const item = record(value, ['subject', 'kind', 'detail']);
    if (!isPortableLayerPlanningNote(item.subject, 200) || !isPortableLayerPlanningNote(item.detail, 1000)
      || !['unreadable-text', 'unknown-value', 'unknown-component'].includes(String(item.kind))) fail();
    return item as unknown as LayerMissingInput;
  });
  if ((row.reason === 'construction-incomplete' && missingInputs.length !== 0)
    || (row.reason === 'required-semantics-missing' && missingInputs.length === 0)) fail();
  return { summary: row.summary, issues: [...row.issues] as string[], reason: row.reason as LayerPlanningDiagnostic['reason'], missingInputs };
}
export class LayerPlanningDiagnosticError extends Error {
  readonly diagnostic: LayerPlanningDiagnostic;
  constructor(code: string, input: unknown) { super(code); this.diagnostic = validateLayerPlanningDiagnostic(input); }
}
export class LayerPlanningUnresolvedError extends LayerPlanningDiagnosticError {
  constructor(input: unknown) {
    super('LAYER_PLANNING_UNRESOLVED', input);
    if (this.diagnostic.reason && this.diagnostic.reason !== 'required-semantics-missing') fail();
  }
}
export class LayerPlanningIncompleteError extends LayerPlanningDiagnosticError {
  constructor(input: unknown) {
    super('LAYER_PLANNING_CONSTRUCTION_INCOMPLETE', input);
    if (this.diagnostic.reason !== 'construction-incomplete') fail();
  }
}
function fail(): never { throw new Error('LAYER_PLANNING_EVIDENCE_INVALID'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== keys.sort().join('|')) fail();
  return row;
}
export function isPortableLayerPlanningNote(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= maximum
    && !/(?:[A-Za-z]:[\\/]|https?:\/\/|file:\/\/|\/(?:Users|home)\/)/i.test(value);
}
export function requiredLayerDecisionFields(document: UiDocument): { componentId: string; pointer: string }[] {
  const fields: { componentId: string; pointer: string }[] = [];
  for (const node of walkNodes(document)) {
    const pointers = ['/type', '/layout'];
    const props = node.props as unknown as Record<string, unknown>;
    if (['Container', 'Panel', 'Dialog'].includes(node.type) && Object.hasOwn(props, 'drawBackground')) pointers.push('/props/drawBackground');
    for (const key of ['label', 'title', 'text', 'value', 'placeholder', 'options', 'items', 'tabs', 'selectedId', 'activeId',
      'checked', 'open', 'enabled', 'modal', 'readOnly', 'inputType', 'min', 'max', 'step', 'maxLength', 'valueOverflow', 'interaction',
      'scrollX', 'scrollY', 'contentWidth', 'contentHeight', 'itemHeight', 'stateLabels', 'lineHeight', 'wrap', 'overflow']) {
      if (Object.hasOwn(props, key)) pointers.push(`/props/${key}`);
    }
    if (node.type !== 'Image' && node.type !== 'Container') {
      pointers.push(...['fontSize', 'fontFamily', 'fontWeight', 'textColor'].map(key => `/props/style/${key}`));
    }
    const appearance = props.appearance as Record<string, unknown> | undefined;
    for (const key of ['labelLayout', 'titleLayout', 'textLayout', 'placeholderLayout', 'templateSizing', 'selectedIndicator', 'selectedTextColor']) {
      if (appearance && Object.hasOwn(appearance, key)) pointers.push(`/props/appearance/${key}`);
    }
    const labelLines = appearance?.labelLines as { lines: unknown[] } | undefined;
    if (labelLines) for (const [index] of labelLines.lines.entries()) {
      for (const key of ['text', 'fontSize', 'fontWeight', 'align', 'layout']) pointers.push(`/props/appearance/labelLines/lines/${index}/${key}`);
    }
    for (const pointer of pointers) fields.push({ componentId: node.id, pointer });
  }
  return fields;
}
export function validateLayerPlanningEvidence(input: unknown, document: UiDocument): LayerPlanningEvidence {
  const row = record(input, ['version', 'referenceSha256', 'responseSha256', 'findings', 'issues']);
  if (row.version !== '1.0' || !/^[a-f0-9]{64}$/.test(String(row.referenceSha256))
    || !/^[a-f0-9]{64}$/.test(String(row.responseSha256)) || !Array.isArray(row.findings)
    || row.findings.length > 16000 || !Array.isArray(row.issues) || row.issues.length > 256) fail();
  const nodes = new Map(walkNodes(document).map(node => [node.id, node]));
  const seen = new Set<string>();
  const findings = row.findings.map(value => {
    const finding = record(value, ['componentId', 'pointer', 'basis', 'note']);
    if (typeof finding.componentId !== 'string' || !nodes.has(finding.componentId)
      || typeof finding.pointer !== 'string' || !/^(?:\/children|\/(?:type|layout|props)(?:\/[A-Za-z0-9._~-]+)*)$/.test(finding.pointer)
      || !['observed', 'inferred', 'explicit-policy'].includes(String(finding.basis)) || !isPortableLayerPlanningNote(finding.note, 500)) fail();
    let target: unknown = nodes.get(finding.componentId);
    for (const token of finding.pointer.slice(1).split('/')) {
      const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) fail();
      target = (target as Record<string, unknown>)[key];
    }
    if ((/^\/props\/(?:label|title|text|value|placeholder|options|items|tabs|stateLabels)$/.test(finding.pointer)
      || /^\/props\/appearance\/labelLines\/lines\/\d+\/text$/.test(finding.pointer))
      && ((typeof target === 'string' && target.length > 0) || (Array.isArray(target) && target.length > 0))
      && finding.basis !== 'observed') fail();
    if (finding.pointer === '/props/stateLabels' && finding.basis !== 'observed') fail();
    if (finding.pointer === '/props/drawBackground' && ['Container', 'Panel', 'Dialog'].includes(nodes.get(finding.componentId)!.type) && finding.basis !== 'explicit-policy') fail();
    if (['/props/valueOverflow', '/props/appearance/templateSizing', '/props/appearance/selectedIndicator', '/props/appearance/selectedTextColor'].includes(finding.pointer) && finding.basis !== 'explicit-policy') fail();
    const key = `${finding.componentId}:${finding.pointer}`;
    if (seen.has(key)) fail();
    seen.add(key);
    return finding as unknown as LayerPlanningFinding;
  });
  for (const field of requiredLayerDecisionFields(document)) if (!seen.has(`${field.componentId}:${field.pointer}`)) fail();
  const issues = row.issues.map(value => { if (!isPortableLayerPlanningNote(value, 1000)) fail(); return value; });
  return { version: '1.0', referenceSha256: row.referenceSha256 as string, responseSha256: row.responseSha256 as string, findings, issues };
}
