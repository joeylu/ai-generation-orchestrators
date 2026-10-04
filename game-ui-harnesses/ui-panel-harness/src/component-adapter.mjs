/** Development-only, read-only adapter to the sibling checkout. Not a production installer. */
export async function loadWorkspaceCore() {
  const [compiler, contract, bundle] = await Promise.all([
    import('../../ui-component-harness/src/tree-compiler.ts'),
    import('../../ui-component-harness/src/tree-contract.ts'),
    import('../../ui-component-harness/src/bundle.ts'),
  ]);
  if (contract.UI_SCHEMA_VERSION !== '0.2') throw new Error('COMPONENT_SCHEMA_UNSUPPORTED');
  return Object.freeze({
    compileTree: compiler.compileTree,
    validateDocument: contract.validateDocument,
    createBundle: bundle.createBundle,
    validateBundle: bundle.validateBundle,
    bundleResources: bundle.bundleResources,
  });
}
