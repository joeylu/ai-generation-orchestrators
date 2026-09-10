import { applyAppearanceBinding } from './appearance-apply.ts';
import type { UiBundle } from './bundle.ts';
import { importComponentHandoffArchive } from './decomposition-import.ts';

/** Validate and compile one complete cross-Harness archive into a runnable bundle. */
export async function importAndApplyComponentHandoff(input: Uint8Array): Promise<UiBundle> {
  const handoff = await importComponentHandoffArchive(input);
  return applyAppearanceBinding(
    handoff.componentBundle, handoff.decomposition, handoff.appearanceBinding,
  );
}
