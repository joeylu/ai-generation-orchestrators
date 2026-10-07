/** Development-only, read-only adapter to the sibling checkout. Not a production installer. */
import { createComponentCore } from './workspace/component-contract.mjs';
export async function loadWorkspaceCore() {
  const [compiler, contract, bundle] = await Promise.all([
    import('../../ui-component-harness/src/tree-compiler.ts'),
    import('../../ui-component-harness/src/tree-contract.ts'),
    import('../../ui-component-harness/src/bundle.ts'),
  ]);
  return createComponentCore(compiler, contract, bundle);
}
