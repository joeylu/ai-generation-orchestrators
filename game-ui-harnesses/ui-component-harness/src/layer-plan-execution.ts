/** Portable execution counts; local session IDs and transport logs stay private. */
export interface LayerPlanExecution { version: '1.0'; maxCorrections: 3; corrections: number;
  modelTurns: number; transportRetries: 0; renderCheck: 'pass'; humanVisualAcceptance: false }
export function validateLayerPlanExecution(value: unknown): LayerPlanExecution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LAYER_PLANNING_EXECUTION_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== 'corrections|humanVisualAcceptance|maxCorrections|modelTurns|renderCheck|transportRetries|version'
    || row.version !== '1.0' || row.maxCorrections !== 3 || !Number.isInteger(row.corrections)
    || (row.corrections as number) < 0 || (row.corrections as number) > 3 || row.modelTurns !== (row.corrections as number) + 1
    || row.transportRetries !== 0 || row.renderCheck !== 'pass' || row.humanVisualAcceptance !== false) throw new Error('LAYER_PLANNING_EXECUTION_INVALID');
  return row as unknown as LayerPlanExecution;
}
