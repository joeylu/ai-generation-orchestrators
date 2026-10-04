import { applyAppearanceBinding } from './appearance-apply.ts';
import { validateBundle, type UiBundle } from './bundle.ts';
import { encodeArchive, referenceSha256, zip } from './reference-persistence.ts';
import { DecompositionImportError, decompositionArchive, importComponentHandoffArchive, importDecompositionZip, type ImportedDecomposition } from './decomposition-import.ts';
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
  result.bundle = await validateBundle({ ...result.bundle, bundleVersion: '0.3', componentHandoff: { sha256: result.archiveSha256, base64: encodeArchive(input) } });
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
  return compileImportedAssets(imported, target, binding);
}

/** Shared Studio/CLI path. New source evidence survives every save/export. */
export async function compileImportedAssets(imported: ImportedDecomposition, target: unknown, binding: unknown) {
  const bundle = await applyAppearanceBinding(target, imported, binding);
  validateAppliedComponentCoverage(bundle);
  if (imported.assetsPackage) {
    const source = await decompositionArchive(imported);
    const semantic = await validateBundle(target);
    if (semantic.componentHandoff) throw new Error('RECURSIVE_COMPONENT_HANDOFF');
    const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    const semanticBytes = encode(semantic), bindingBytes = encode(binding);
    const reviewed = imported.review.humanVisualAcceptance;
    const entries = new Map<string,Uint8Array>([
      ['decomposition/assets.zip',source], ['component.ui-bundle.json',semanticBytes], ['appearance-binding.json',bindingBytes],
      ['handoff.json',encode({kind:'ai_ui_component_handoff_v1',status:reviewed?'contracts_packaged_reviewed':'contracts_packaged_unreviewed_draft',
        decomposition:{path:'decomposition/assets.zip',sha256:imported.archiveSha256},
        component_bundle:{path:'component.ui-bundle.json',sha256:await referenceSha256(semanticBytes)},
        appearance_binding:{path:'appearance-binding.json',sha256:await referenceSha256(bindingBytes)},
        delivery_policy:imported.review.deliveryPolicy,human_visual_acceptance:reviewed})],
    ]);
    const result = await importComponentHandoffWithReview(zip(entries));
    return {bundle:result.bundle,archiveSha256:imported.archiveSha256,review:imported.review};
  }
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
