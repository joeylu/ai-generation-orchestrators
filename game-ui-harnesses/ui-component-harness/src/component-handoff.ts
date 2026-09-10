import { applyAppearanceBinding } from './appearance-apply.ts';
import type { UiBundle } from './bundle.ts';
import { DecompositionImportError, importComponentHandoffArchive } from './decomposition-import.ts';

/** Validate and compile one complete cross-Harness archive into a runnable bundle. */
export async function importAndApplyComponentHandoff(input: Uint8Array): Promise<UiBundle> {
  const handoff = await importComponentHandoffArchive(input);
  const bundle = await applyAppearanceBinding(
    handoff.componentBundle, handoff.decomposition, handoff.appearanceBinding,
  );
  if (bundle.document.schemaVersion === '0.2' && bundle.document.root.props.style.opacity === 0) {
    throw new DecompositionImportError('COMPONENT_HANDOFF_INVISIBLE_ROOT');
  }
  return bundle;
}
