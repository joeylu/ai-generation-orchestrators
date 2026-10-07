/** The browser's only boundary to the sibling component source tree. */
import * as compiler from '../../../ui-component-harness/src/tree-compiler.ts';
import * as contract from '../../../ui-component-harness/src/tree-contract.ts';
import * as bundle from '../../../ui-component-harness/src/bundle.ts';
import { createComponentCore } from './component-contract.mjs';

export { createTreePreview } from '../../../ui-component-harness/src/tree-runtime.ts';
export { MotionAnimator, getMotionStyle } from '../../../ui-component-harness/src/motion-system.ts';
export const componentCore = createComponentCore(compiler, contract, bundle);
