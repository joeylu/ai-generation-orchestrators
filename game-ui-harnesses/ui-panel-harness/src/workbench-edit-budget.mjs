import { snapshotJson } from './spec.mjs';

export const WORKBENCH_EDIT_LIMIT = 10;

/** Studio policy only; never add operational counters to the engine-neutral PanelBundle. */
export function validateWorkbenchEditUsage(input) {
  const value = snapshotJson(input);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.entries(value).some(([id, used]) => !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id)
      || !Number.isInteger(used) || used < 0 || used > WORKBENCH_EDIT_LIMIT)) throw new Error('WORKBENCH_EDIT_USAGE');
  return value;
}
