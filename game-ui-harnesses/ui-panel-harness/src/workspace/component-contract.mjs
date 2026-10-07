import { WORKSPACE_REQUIREMENTS } from './requirements.mjs';

/** Validate the required extension even when the upstream schema version is unchanged. */
export function createComponentCore(compiler, contract, bundle) {
  if (contract?.UI_SCHEMA_VERSION !== WORKSPACE_REQUIREMENTS.component.schemaVersion) {
    throw new Error('COMPONENT_SCHEMA_UNSUPPORTED');
  }
  const core = {
    compileTree: compiler?.compileTree,
    validateDocument: contract.validateDocument,
    createBundle: bundle?.createBundle,
    validateBundle: bundle?.validateBundle,
    bundleResources: bundle?.bundleResources,
  };
  if (Object.values(core).some(value => typeof value !== 'function')) throw new Error('COMPONENT_API_UNSUPPORTED');
  const style = { backgroundColor: '#FFFFFF', borderColor: '#000000', borderWidth: 0,
    cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 14,
    fontWeight: 'normal', opacity: 1 };
  const probe = { schemaVersion: WORKSPACE_REQUIREMENTS.component.schemaVersion, id: 'panel-capability-probe',
    canvas: { width: 100, height: 32 }, root: { id: 'probe-input', type: 'Input',
      layout: { x: 0, y: 0, width: 100, height: 32 }, props: { value: 'probe', placeholder: '',
        inputType: 'text', readOnly: false, maxLength: 64, enabled: true, valueOverflow: 'ellipsis', style } } };
  try {
    const checked = core.validateDocument(probe);
    if (checked?.root?.props?.valueOverflow !== 'ellipsis') throw new Error('CAPABILITY_NOT_PRESERVED');
  } catch {
    // Never forward diagnostics from optional dependencies: they may contain host paths.
    throw new Error('COMPONENT_INPUT_OVERFLOW_UNSUPPORTED');
  }
  return Object.freeze(core);
}
