import { HarnessError } from './contract.ts';
import { validateMotion, type MotionDocument } from './motion.ts';
import {
  compileMotionSystem, validateMotionSystem,
  type MotionStyle, type MotionSystemDocument,
} from './motion-system.ts';
import {
  compileTree,
  type ImageFactsMap, type TreeIntent, type TreePolicy,
} from './tree-compiler.ts';
import { validateDocument, walkNodes, type UiDocument } from './tree-contract.ts';

/** The provider-free, engine-neutral workflow request revision. */
export const WORKFLOW_VERSION = '0.1' as const;

export interface WorkflowIntentInput {
  kind: 'intent';
  intent: TreeIntent;
  policy: TreePolicy;
  facts: ImageFactsMap;
}

export interface WorkflowDocumentInput {
  kind: 'document';
  document: UiDocument;
}

export type WorkflowInput = WorkflowIntentInput | WorkflowDocumentInput;

/** A caller must explicitly select every target or the complete compiled tree. */
export interface WorkflowMotionRequest {
  id: string;
  style: MotionStyle;
  targets: 'all' | string[];
}

export interface WorkflowRequest {
  workflowVersion: typeof WORKFLOW_VERSION;
  id: string;
  input: WorkflowInput;
  motion: WorkflowMotionRequest | null;
  timeline?: MotionDocument;
}

export interface WorkflowDocument {
  id: string;
  document: UiDocument;
  motionSystem?: MotionSystemDocument;
  motion?: MotionDocument;
}

const MAX_IDENTIFIER_LENGTH = 128;
const identifier = /^[A-Za-z][A-Za-z0-9._-]*$/;

function fail(path: string, code: string, message: string): never {
  throw new HarnessError('compile', [{ path, code, message }]);
}

function record(value: unknown, path: string, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'OBJECT_REQUIRED', 'must be an object');
  const data = value as Record<string, unknown>;
  for (const key of required) if (!Object.hasOwn(data, key)) fail(`${path}.${key}`, 'REQUIRED', 'required field is missing');
  for (const key of Object.keys(data)) if (!keys.includes(key)) fail(`${path}.${key}`, 'UNSUPPORTED_FIELD', 'unknown fields are not accepted');
  return data;
}

function validIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH || !identifier.test(value)) {
    fail(path, 'INVALID_ID', 'must be a bounded UI-compatible identifier');
  }
  return value;
}

function remap(error: unknown, mappings: readonly [from: string, to: string][]): never {
  if (error instanceof HarnessError) {
    const issues = error.issues.map(issue => {
      for (const [from, to] of mappings) {
        if (issue.path === from) return { ...issue, path: to };
        if (issue.path.startsWith(`${from}.`) || issue.path.startsWith(`${from}[`)) {
          return { ...issue, path: `${to}${issue.path.slice(from.length)}` };
        }
      }
      return issue;
    });
    throw new HarnessError(error.stage, issues);
  }
  throw error;
}

function looksLikeLegacyWorkflow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (Object.hasOwn(data, 'input') || Object.hasOwn(data, 'workflowVersion')) return false;
  return ['schemaVersion', 'intentVersion', 'document', 'intent', 'policy', 'facts', 'motionSystem']
    .some(key => Object.hasOwn(data, key));
}

function looksLikeLegacyInput(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (data.kind === 'intent') {
    const intent = data.intent as Record<string, unknown> | null;
    return typeof intent === 'object' && intent !== null && intent.intentVersion === '0.1';
  }
  if (data.kind === 'document') {
    const document = data.document as Record<string, unknown> | null;
    return typeof document === 'object' && document !== null && document.schemaVersion === '0.1';
  }
  return !Object.hasOwn(data, 'kind') && ['schemaVersion', 'intentVersion', 'document', 'intent', 'policy', 'facts']
    .some(key => Object.hasOwn(data, key));
}

function compileInput(value: unknown): UiDocument {
  if (looksLikeLegacyInput(value)) fail('$workflow.input', 'LEGACY_INPUT', 'legacy component input is not accepted; use an explicit v0.2 input kind');
  const candidate = record(value, '$workflow.input', ['kind', 'intent', 'policy', 'facts', 'document'], ['kind']);
  if (candidate.kind !== 'intent' && candidate.kind !== 'document') {
    fail('$workflow.input.kind', 'UNSUPPORTED_INPUT_KIND', 'must be intent or document');
  }
  if (candidate.kind === 'intent') {
    const input = record(value, '$workflow.input', ['kind', 'intent', 'policy', 'facts']);
    try {
      return validateDocument(compileTree(input.intent, input.facts, input.policy));
    } catch (error) {
      remap(error, [
        ['$intent', '$workflow.input.intent'],
        ['$policy', '$workflow.input.policy'],
        ['$facts', '$workflow.input.facts'],
      ]);
    }
  }
  const input = record(value, '$workflow.input', ['kind', 'document']);
  try {
    return validateDocument(input.document);
  } catch (error) {
    remap(error, [['$', '$workflow.input.document']]);
  }
}

function compileMotion(value: unknown, document: UiDocument): MotionSystemDocument | undefined {
  if (value === null) return undefined;
  const input = record(value, '$workflow.motion', ['id', 'style', 'targets']);
  let targets: unknown;
  if (input.targets === 'all') targets = walkNodes(document).map(node => node.id);
  else if (Array.isArray(input.targets)) targets = input.targets;
  else fail('$workflow.motion.targets', 'ARRAY_REQUIRED', 'must be all or an array of target IDs');
  try {
    const compiled = compileMotionSystem({ id: input.id, style: input.style, targets }, document);
    return validateMotionSystem(compiled, document);
  } catch (error) {
    remap(error, [['$motionSystemInput', '$workflow.motion'], ['$motionSystem', '$workflow.motionSystem']]);
  }
}

function validateTimeline(value: unknown, document: UiDocument): MotionDocument {
  try {
    return validateMotion(value, document);
  } catch (error) {
    remap(error, [['$motion', '$workflow.timeline']]);
  }
}

/**
 * Compile one explicit v0.2 UI source into an engine-neutral document with an
 * optional motion system and/or already-authored timeline. This performs no IO
 * and never supplies a style, target, timeline, or source conversion.
 */
export function compileWorkflow(input: unknown): WorkflowDocument {
  if (looksLikeLegacyWorkflow(input)) {
    fail('$workflow.input', 'LEGACY_INPUT', 'legacy component input is not accepted; use workflowVersion 0.1');
  }
  const request = record(input, '$workflow', ['workflowVersion', 'id', 'input', 'motion', 'timeline'], ['workflowVersion', 'id', 'input', 'motion']);
  if (request.workflowVersion !== WORKFLOW_VERSION) {
    fail('$workflow.workflowVersion', 'UNSUPPORTED_VERSION', 'only workflowVersion 0.1 is supported');
  }
  const id = validIdentifier(request.id, '$workflow.id');
  const document = compileInput(request.input);
  const motionSystem = compileMotion(request.motion, document);
  const motion = Object.hasOwn(request, 'timeline') ? validateTimeline(request.timeline, document) : undefined;
  if (!motionSystem && !motion) {
    fail('$workflow', 'MOTION_INTEGRATION_REQUIRED', 'an explicit motion system or timeline is required');
  }
  const result: WorkflowDocument = { id, document };
  if (motionSystem) result.motionSystem = motionSystem;
  if (motion) result.motion = motion;
  return structuredClone(result);
}
