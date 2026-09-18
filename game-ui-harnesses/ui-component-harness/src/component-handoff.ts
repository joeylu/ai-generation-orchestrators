import { applyAppearanceBinding } from './appearance-apply.ts';
import { validateBundle, type UiBundle } from './bundle.ts';
import { encodeArchive } from './reference-persistence.ts';
import { DecompositionImportError, importComponentHandoffArchive, importDecompositionZip } from './decomposition-import.ts';
import { walkNodes, type UiNode } from './tree-contract.ts';
import { restoreRuntimeBundle } from './runtime-bundle.ts';

const INTERACTIVE_TYPES = new Set([
  'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select', 'Slider',
  'ScrollView', 'List', 'Dialog', 'Tabs',
]);

function hasInvisibleInteractive(node: UiNode, transparentAncestor = false): boolean {
  const transparent = transparentAncestor || node.props.style.opacity === 0;
  return (transparent && INTERACTIVE_TYPES.has(node.type))
    || ('children' in node && node.children.some(child => hasInvisibleInteractive(child, transparent)));
}

/** Validate and compile one complete cross-Harness archive into a runnable bundle. */
export async function importAndApplyComponentHandoff(input: Uint8Array): Promise<UiBundle> {
  return (await importComponentHandoffWithReview(input)).bundle;
}

/** Same compiler and gates as the CLI, with authenticated source review metadata. */
export async function importComponentHandoffWithReview(input: Uint8Array) {
  const result = await compileComponentHandoff(input);
  if (result.referenceEvidence.status === 'complete') {
    result.bundle = await validateBundle({ ...result.bundle, bundleVersion: '0.3', componentHandoff: { sha256: result.archiveSha256, base64: encodeArchive(input) } });
  }
  return result;
}

/** Internal compiler does not recursively attach the enclosing archive. */
export async function compileComponentHandoff(input: Uint8Array) {
  const handoff = await importComponentHandoffArchive(input);
  let bundle = await applyAppearanceBinding(
    handoff.componentBundle, handoff.decomposition, handoff.appearanceBinding,
  );
  if (handoff.runtimeBundle) bundle = await validateBundle(restoreRuntimeBundle(bundle, handoff.runtimeBundle));
  validateAppliedComponentCoverage(bundle);
  return { bundle, hasRuntimeBundle: !!handoff.runtimeBundle, archiveSha256: handoff.archiveSha256, review: handoff.review, referenceEvidence: handoff.referenceEvidence };
}

/** Build from independent assets plus authored semantics; never infer missing states. */
export async function compileDecompositionAssets(input: Uint8Array, target: unknown, binding: unknown) {
  const imported = await importDecompositionZip(input);
  const bundle = await applyAppearanceBinding(target, imported, binding);
  validateAppliedComponentCoverage(bundle);
  return { bundle, archiveSha256: imported.archiveSha256, review: imported.review };
}

function validateAppliedComponentCoverage(bundle: UiBundle): void {
  if (bundle.document.schemaVersion === '0.2'
    && walkNodes(bundle.document).some(
      node => INTERACTIVE_TYPES.has(node.type) && !Object.hasOwn(node.props, 'appearance'),
    )) {
    throw new DecompositionImportError('COMPONENT_HANDOFF_INTERACTIVE_BINDING_REQUIRED');
  }
  if (bundle.document.schemaVersion === '0.2' && bundle.document.root.props.style.opacity === 0) {
    throw new DecompositionImportError('COMPONENT_HANDOFF_INVISIBLE_ROOT');
  }
  if (bundle.document.schemaVersion === '0.2'
    && hasInvisibleInteractive(bundle.document.root)) {
    throw new DecompositionImportError('COMPONENT_HANDOFF_INVISIBLE_INTERACTIVE');
  }
}
