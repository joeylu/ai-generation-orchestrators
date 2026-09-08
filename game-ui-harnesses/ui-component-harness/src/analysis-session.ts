/**
 * A provider-free ledger for a caller's UI analysis classification. It records
 * provenance and retry limits, but deliberately cannot create a render tree.
 */
import { HarnessError, type Issue } from './contract.ts';
import { ResourceReferenceError, validateResourceReference } from './resource-reference.ts';
import type { UiNodeType } from './tree-contract.ts';

export const ANALYSIS_SESSION_VERSION = '0.1' as const;
export const MAX_ANALYSIS_ATTEMPTS = 32;

export type AnalysisStatus = 'Supported' | 'Composite' | 'Unresolved' | 'Custom-required' | 'FAILED' | 'NOT_RUN';
export type RecordedAnalysisStatus = Exclude<AnalysisStatus, 'NOT_RUN'>;

/** A portable reference and immutable source digest supplied by the caller. */
export interface AnalysisSource {
  reference: string;
  sha256: string;
}

export interface SupportedAnalysis {
  status: 'Supported';
  summary: string;
  componentType: UiNodeType;
}
export interface CompositeAnalysis {
  status: 'Composite';
  summary: string;
  componentTypes: UiNodeType[];
}
export interface UnresolvedAnalysis { status: 'Unresolved'; reason: string }
export interface CustomRequiredAnalysis { status: 'Custom-required'; reason: string }
export interface FailedAnalysis { status: 'FAILED'; reason: string }
export type RecordedAnalysis = SupportedAnalysis | CompositeAnalysis | UnresolvedAnalysis | CustomRequiredAnalysis | FailedAnalysis;

export interface AnalysisAttempt {
  attempt: number;
  source: AnalysisSource;
  result: RecordedAnalysis;
}
export interface AnalysisSession {
  analysisVersion: typeof ANALYSIS_SESSION_VERSION;
  id: string;
  source: AnalysisSource;
  attemptBudget: number;
  attempts: AnalysisAttempt[];
}
export interface AnalysisSessionInput {
  analysisVersion: typeof ANALYSIS_SESSION_VERSION;
  id: string;
  source: AnalysisSource;
  attemptBudget: number;
}
export interface AnalysisRecordInput {
  source: AnalysisSource;
  result: RecordedAnalysis;
}
export interface AnalysisReport {
  id: string;
  source: AnalysisSource;
  attemptBudget: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  status: AnalysisStatus;
  canStartAnalysis: boolean;
  canReanalyze: boolean;
  attempts: AnalysisAttempt[];
}

const identifierPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;
const digestPattern = /^[a-f0-9]{64}$/;
const nodeTypes = new Set<UiNodeType>([
  'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
  'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
]);

class Validator {
  readonly issues: Issue[] = [];

  add(path: string, code: string, message: string): void { this.issues.push({ path, code, message }); }
  object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.add(path, 'OBJECT_REQUIRED', 'must be an object'); return null;
    }
    const object = value as Record<string, unknown>;
    for (const key of keys) if (!Object.hasOwn(object, key)) this.add(`${path}.${key}`, 'REQUIRED', 'required field is missing');
    for (const key of Object.keys(object)) if (!keys.includes(key)) this.add(`${path}.${key}`, 'UNSUPPORTED_FIELD', 'unknown fields are not accepted');
    return object;
  }
  string(value: unknown, path: string): value is string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 2000) {
      this.add(path, 'STRING_REQUIRED', 'must be a non-empty trimmed string of at most 2,000 characters'); return false;
    }
    return true;
  }
  identifier(value: unknown, path: string): value is string {
    if (!this.string(value, path)) return false;
    if (!identifierPattern.test(value)) { this.add(path, 'INVALID_ID', 'must begin with a letter and use only letters, digits, dot, underscore, or hyphen'); return false; }
    return true;
  }
  source(value: unknown, path: string): value is AnalysisSource {
    const source = this.object(value, path, ['reference', 'sha256']);
    if (!source) return false;
    if (typeof source.reference !== 'string') this.add(`${path}.reference`, 'SOURCE_REQUIRED', 'must be a portable resource reference');
    else {
      try { validateResourceReference(source.reference, `${path}.reference`, 'contract'); }
      catch (error) {
        const code = error instanceof ResourceReferenceError ? error.code : 'INVALID_RESOURCE_REFERENCE';
        this.add(`${path}.reference`, code, error instanceof Error ? error.message : 'invalid resource reference');
      }
    }
    if (typeof source.sha256 !== 'string' || !digestPattern.test(source.sha256)) this.add(`${path}.sha256`, 'INVALID_SHA256', 'must be a lowercase 64-character SHA-256 hex digest');
    return true;
  }
  componentType(value: unknown, path: string): value is UiNodeType {
    if (typeof value !== 'string' || !nodeTypes.has(value as UiNodeType)) {
      this.add(path, 'UNSUPPORTED_COMPONENT_TYPE', 'must be a supported v0.2 component type'); return false;
    }
    return true;
  }
  result(value: unknown, path: string): value is RecordedAnalysis {
    const rawStatus = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).status : undefined;
    const keys = rawStatus === 'Supported' ? ['status', 'summary', 'componentType']
      : rawStatus === 'Composite' ? ['status', 'summary', 'componentTypes']
        : rawStatus === 'Unresolved' || rawStatus === 'Custom-required' || rawStatus === 'FAILED' ? ['status', 'reason']
          : ['status'];
    const result = this.object(value, path, keys);
    if (!result) return false;
    if (rawStatus === 'NOT_RUN') {
      this.add(`${path}.status`, 'NON_RECORDABLE_STATUS', 'NOT_RUN is a derived session state and cannot be recorded'); return false;
    }
    if (rawStatus !== 'Supported' && rawStatus !== 'Composite' && rawStatus !== 'Unresolved' && rawStatus !== 'Custom-required' && rawStatus !== 'FAILED') {
      this.add(`${path}.status`, 'UNSUPPORTED_STATUS', 'must be Supported, Composite, Unresolved, Custom-required, or FAILED'); return false;
    }
    if (rawStatus === 'Supported') {
      this.string(result.summary, `${path}.summary`); this.componentType(result.componentType, `${path}.componentType`);
    } else if (rawStatus === 'Composite') {
      this.string(result.summary, `${path}.summary`);
      if (!Array.isArray(result.componentTypes)) this.add(`${path}.componentTypes`, 'ARRAY_REQUIRED', 'must be an array of at least two component types');
      else {
        if (result.componentTypes.length < 2) this.add(`${path}.componentTypes`, 'MIN_ITEMS_REQUIRED', 'must contain at least two component types');
        const seen = new Set<string>();
        result.componentTypes.forEach((component, index) => {
          if (this.componentType(component, `${path}.componentTypes[${index}]`) && seen.has(component)) this.add(`${path}.componentTypes[${index}]`, 'DUPLICATE_COMPONENT_TYPE', 'component types must be unique');
          else if (typeof component === 'string') seen.add(component);
        });
      }
    } else this.string(result.reason, `${path}.reason`);
    return true;
  }
  finish(): void { if (this.issues.length) throw new HarnessError('contract', this.issues); }
}

function sameSource(left: AnalysisSource, right: AnalysisSource): boolean {
  return left.reference === right.reference && left.sha256 === right.sha256;
}

/** Validate and clone a new, empty analysis ledger. This function does no analysis or IO. */
export function createAnalysisSession(input: unknown): AnalysisSession {
  const validator = new Validator();
  const session = validator.object(input, '$analysis', ['analysisVersion', 'id', 'source', 'attemptBudget']);
  if (session) {
    if (session.analysisVersion !== ANALYSIS_SESSION_VERSION) validator.add('$analysis.analysisVersion', 'UNSUPPORTED_VERSION', 'only analysisVersion 0.1 is supported');
    validator.identifier(session.id, '$analysis.id'); validator.source(session.source, '$analysis.source');
    if (!Number.isSafeInteger(session.attemptBudget) || typeof session.attemptBudget !== 'number' || session.attemptBudget < 1 || session.attemptBudget > MAX_ANALYSIS_ATTEMPTS) {
      validator.add('$analysis.attemptBudget', 'INVALID_ATTEMPT_BUDGET', `must be a safe integer from 1 through ${MAX_ANALYSIS_ATTEMPTS}`);
    }
  }
  validator.finish();
  const plan = structuredClone(input) as AnalysisSessionInput;
  return { ...plan, attempts: [] };
}

/** Validate a persisted ledger. All retries after the first must follow an Unresolved result. */
export function validateAnalysisSession(input: unknown): AnalysisSession {
  const validator = new Validator();
  const session = validator.object(input, '$analysis', ['analysisVersion', 'id', 'source', 'attemptBudget', 'attempts']);
  let source: AnalysisSource | undefined;
  let budget: number | undefined;
  if (session) {
    if (session.analysisVersion !== ANALYSIS_SESSION_VERSION) validator.add('$analysis.analysisVersion', 'UNSUPPORTED_VERSION', 'only analysisVersion 0.1 is supported');
    validator.identifier(session.id, '$analysis.id');
    if (validator.source(session.source, '$analysis.source')) source = session.source as AnalysisSource;
    if (!Number.isSafeInteger(session.attemptBudget) || typeof session.attemptBudget !== 'number' || session.attemptBudget < 1 || session.attemptBudget > MAX_ANALYSIS_ATTEMPTS) {
      validator.add('$analysis.attemptBudget', 'INVALID_ATTEMPT_BUDGET', `must be a safe integer from 1 through ${MAX_ANALYSIS_ATTEMPTS}`);
    } else budget = session.attemptBudget;
    if (!Array.isArray(session.attempts)) validator.add('$analysis.attempts', 'ARRAY_REQUIRED', 'must be an array');
    else {
      const attempts = session.attempts;
      if (budget !== undefined && attempts.length > budget) validator.add('$analysis.attempts', 'ATTEMPT_BUDGET_EXHAUSTED', 'attempt count exceeds attemptBudget');
      attempts.forEach((entry, index) => {
        const path = `$analysis.attempts[${index}]`;
        const attempt = validator.object(entry, path, ['attempt', 'source', 'result']);
        if (!attempt) return;
        if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt !== index + 1) validator.add(`${path}.attempt`, 'INVALID_ATTEMPT_NUMBER', 'must be the next sequential positive attempt number');
        const validSource = validator.source(attempt.source, `${path}.source`);
        if (validSource && source && !sameSource(attempt.source as AnalysisSource, source)) validator.add(`${path}.source`, 'SOURCE_MISMATCH', 'must exactly match the ledger source reference and digest');
        validator.result(attempt.result, `${path}.result`);
        if (index < attempts.length - 1 && (attempt.result as Record<string, unknown> | undefined)?.status !== 'Unresolved') {
          validator.add(`${path}.result.status`, 'REANALYSIS_NOT_ALLOWED', 'only an Unresolved result may be followed by another attempt');
        }
      });
    }
  }
  validator.finish();
  return structuredClone(input) as AnalysisSession;
}

function validateRecordInput(input: unknown): AnalysisRecordInput {
  const validator = new Validator();
  const record = validator.object(input, '$record', ['source', 'result']);
  if (record) { validator.source(record.source, '$record.source'); validator.result(record.result, '$record.result'); }
  validator.finish();
  return structuredClone(input) as AnalysisRecordInput;
}

/**
 * Record a caller-supplied classification. The first record is allowed only
 * from NOT_RUN; a later record is allowed only after Unresolved and within the
 * explicit budget. No renderer, provider, or fallback result is invoked.
 */
export function recordAnalysis(sessionInput: unknown, recordInput: unknown): AnalysisSession {
  const session = validateAnalysisSession(sessionInput);
  const record = validateRecordInput(recordInput);
  const report = analysisReport(session);
  const issues: Issue[] = [];
  if (!sameSource(record.source, session.source)) issues.push({ path: '$record.source', code: 'SOURCE_MISMATCH', message: 'must exactly match the ledger source reference and digest' });
  if (report.attemptsRemaining === 0) issues.push({ path: '$analysis.attempts', code: 'ATTEMPT_BUDGET_EXHAUSTED', message: 'attemptBudget has no remaining attempts' });
  if (report.status !== 'NOT_RUN' && report.status !== 'Unresolved') issues.push({ path: '$analysis.attempts', code: 'REANALYSIS_NOT_ALLOWED', message: `cannot record another result after ${report.status}` });
  if (issues.length) throw new HarnessError('contract', issues);
  return {
    ...session,
    attempts: [...session.attempts, { attempt: session.attempts.length + 1, source: structuredClone(record.source), result: structuredClone(record.result) }],
  };
}

/** Return a cloned ledger report; NOT_RUN is derived only when no attempt exists. */
export function analysisReport(input: unknown): AnalysisReport {
  const session = validateAnalysisSession(input);
  const last = session.attempts.at(-1);
  const status: AnalysisStatus = last ? last.result.status : 'NOT_RUN';
  const attemptsRemaining = session.attemptBudget - session.attempts.length;
  return {
    id: session.id,
    source: structuredClone(session.source),
    attemptBudget: session.attemptBudget,
    attemptsUsed: session.attempts.length,
    attemptsRemaining,
    status,
    canStartAnalysis: status === 'NOT_RUN' && attemptsRemaining > 0,
    canReanalyze: status === 'Unresolved' && attemptsRemaining > 0,
    attempts: structuredClone(session.attempts),
  };
}
