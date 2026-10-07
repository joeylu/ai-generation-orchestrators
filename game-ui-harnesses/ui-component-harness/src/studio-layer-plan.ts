/** Browser transport for the layer planning stage; never calls the vision endpoint. */
import type { LayerPlanningInput } from './layer-auto-dag.ts';
import { LayerPlanningUnresolvedError, LayerPlanningDiagnosticError } from './layer-planning-evidence.ts';
const MAX_RESPONSE = 4 * 1024 * 1024;
import { validateLayerPlanExecution, type LayerPlanExecution } from './layer-plan-execution.ts';
export { validateLayerPlanExecution } from './layer-plan-execution.ts';
export type { LayerPlanExecution } from './layer-plan-execution.ts';
function base64(bytes: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) result += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(result);
}
export async function requestLayerPlan(archive: Uint8Array, input: LayerPlanningInput, signal: AbortSignal,
  onExecution?: (execution: LayerPlanExecution) => void): Promise<unknown> {
  const response = await fetch('/api/ui-layer-plan', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '1.0', archive: { sha256: input.archiveSha256, base64: base64(archive) } }) });
  const reader = response.body?.getReader(); if (!reader) throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > MAX_RESPONSE) { await reader.cancel(); throw new Error('LAYER_PLANNING_RESPONSE_LIMIT'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('LAYER_PLANNING_RESPONSE_INVALID'); }
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'error' in value ? value.error : undefined;
    if (code === 'LAYER_PLANNING_UNRESOLVED' && value && typeof value === 'object' && 'diagnostic' in value) {
      throw new LayerPlanningUnresolvedError(value.diagnostic);
    }
    if (code === 'SESSION_CORRECTIONS_EXHAUSTED' && value && typeof value === 'object' && 'diagnostic' in value) {
      throw new LayerPlanningDiagnosticError(code, value.diagnostic);
    }
    throw new Error(typeof code === 'string' && /^(?:SESSION|LAYER_PLANN(?:ER|ING)|LAYER_PLAN)_[A-Z0-9_]+$/.test(code) ? code : 'LAYER_PLANNER_FAILED_NO_RETRY');
  }
  if (value && typeof value === 'object' && 'version' in value && value.version === '2.0') {
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join('|') !== 'execution|proposal|version') throw new Error('LAYER_PLANNING_RESPONSE_INVALID');
    if (row.execution !== null) { const execution = validateLayerPlanExecution(row.execution); onExecution?.(execution); }
    return row.proposal;
  }
  return value;
}
