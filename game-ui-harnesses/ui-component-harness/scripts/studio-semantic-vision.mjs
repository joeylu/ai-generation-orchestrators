/**
 * One-stage semantic-vision adapter.
 *
 * The model is permitted to report source-visible v0.2 observations only.
 * Deterministic code owns the observation-to-document compilation, so this
 * adapter never opens a second contract-generation task.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateObservation } from '../src/vision-observation.ts';
import {
  configuredVisionStateDirectory,
  pollStage as mcpPollStage,
  submitStage as mcpSubmitStage,
  validateStageInput,
} from './studio-mcp-vision.mjs';
import { buildObservationInstruction } from './studio-staged-vision.mjs';

const SOURCE_PROTOCOL_VERSION = '0.1';
const OBSERVATION_VERSION = '0.2';
const RESULT_VERSION = '0.4';
const PIPELINE_RECORD_VERSION = '0.1';
const PIPELINE_KIND = 'semantic-v0.4';
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_SUBMISSION_RECORD_BYTES = (3 * 1024 * 1024) + 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TERMINAL_STATUSES = new Set(['Observed', 'Unresolved', 'Custom-required']);

export class SemanticVisionError extends Error {
  constructor(code) { super(code); this.name = 'SemanticVisionError'; }
}

function fail(code) { throw new SemanticVisionError(code); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) { return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function validId(value) { return typeof value === 'string' && UUID.test(value); }
function sourceIdentity(source) {
  return { path: source.path, sha256: source.sha256, width: source.width, height: source.height, mime: source.mime };
}
function sameSource(left, right) {
  return record(left) && record(right) && left.path === right.path && left.sha256 === right.sha256
    && left.width === right.width && left.height === right.height && left.mime === right.mime;
}
function validSource(source) {
  return exact(source, ['path', 'sha256', 'width', 'height', 'mime'])
    && typeof source.path === 'string' && source.path.length > 0 && source.path.length <= 1024
    && /^[A-Za-z0-9._/-]+$/.test(source.path) && !source.path.startsWith('/') && !source.path.includes('\\') && !/^[A-Za-z]:/.test(source.path)
    && source.path.split('/').every(part => part && part !== '.' && part !== '..')
    && typeof source.sha256 === 'string' && HASH.test(source.sha256)
    && Number.isSafeInteger(source.width) && source.width > 0
    && Number.isSafeInteger(source.height) && source.height > 0
    && MIME_TYPES.has(source.mime);
}
function instruction(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096;
}
function pipelineFile(id) { return `${id}.semantic-pipeline.json`; }
function gateFile(fingerprint) { return `semantic-${fingerprint}.gate.json`; }
function stageFile(id) { return `${id}.submission.json`; }

async function readJson(directory, filename) {
  try {
    const text = await readFile(join(directory, filename), 'utf8');
    const limit = filename.endsWith('.submission.json') ? MAX_SUBMISSION_RECORD_BYTES : MAX_RECORD_BYTES;
    if (text.length > limit) fail('MCP_SEMANTIC_RECORD_LIMIT');
    return JSON.parse(text);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined;
    if (error instanceof SemanticVisionError) throw error;
    fail('MCP_SEMANTIC_RECORD_INVALID');
  }
}
async function writeExclusiveJson(directory, filename, value) {
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, filename), `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') return false;
    throw error;
  }
}
function pipelineRecord(value, expectedId) {
  if (!exact(value, ['version', 'kind', 'pipelineId', 'sourceProtocolVersion', 'resultVersion', 'source', 'observation'])) fail('MCP_SEMANTIC_RECORD_INVALID');
  const observation = value.observation;
  if (value.version !== PIPELINE_RECORD_VERSION || value.kind !== PIPELINE_KIND || value.pipelineId !== expectedId
    || !validId(value.pipelineId) || value.sourceProtocolVersion !== SOURCE_PROTOCOL_VERSION || value.resultVersion !== RESULT_VERSION
    || !validSource(value.source) || !exact(observation, ['version', 'submissionId', 'instruction', 'instructionDigest'])
    || observation.version !== OBSERVATION_VERSION || !validId(observation.submissionId)
    || !instruction(observation.instruction) || !HASH.test(observation.instructionDigest)
    || observation.instructionDigest !== digest(observation.instruction)) fail('MCP_SEMANTIC_RECORD_INVALID');
  return value;
}
function samePipeline(left, right) {
  return left.pipelineId === right.pipelineId && left.sourceProtocolVersion === right.sourceProtocolVersion
    && left.resultVersion === right.resultVersion && sameSource(left.source, right.source)
    && left.observation.version === right.observation.version && left.observation.submissionId === right.observation.submissionId
    && left.observation.instruction === right.observation.instruction
    && left.observation.instructionDigest === right.observation.instructionDigest;
}
function samePipelineDefinition(left, right) {
  return left.sourceProtocolVersion === right.sourceProtocolVersion && left.resultVersion === right.resultVersion
    && sameSource(left.source, right.source) && left.observation.version === right.observation.version
    && left.observation.instruction === right.observation.instruction
    && left.observation.instructionDigest === right.observation.instructionDigest;
}
function stageInput(value, pipeline, validateInput) {
  if (!exact(value, ['version', 'submissionId', 'kind', 'status', 'source', 'args'])
    || value.version !== SOURCE_PROTOCOL_VERSION || value.submissionId !== pipeline.observation.submissionId
    || value.kind !== 'observation' || value.status !== 'prepared' || !sameSource(value.source, pipeline.source)
    || !exact(value.args, ['submissionId', 'images', 'instruction', 'targetImageNumber'])
    || value.args.submissionId !== pipeline.observation.submissionId || value.args.instruction !== pipeline.observation.instruction
    || value.args.targetImageNumber !== 1 || !Array.isArray(value.args.images) || value.args.images.length !== 1
    || !exact(value.args.images[0], ['mimeType', 'data']) || value.args.images[0].mimeType !== pipeline.source.mime
    || typeof value.args.images[0].data !== 'string') fail('MCP_SEMANTIC_STAGE_INVALID');
  let input;
  try {
    input = validateInput({ version: SOURCE_PROTOCOL_VERSION, source: { ...pipeline.source, base64: value.args.images[0].data } });
  } catch { fail('MCP_SEMANTIC_STAGE_INVALID'); }
  if (!input || !sameSource(input.source, pipeline.source)) fail('MCP_SEMANTIC_STAGE_INVALID');
  return input;
}
function pending(value, pipeline) {
  if (!exact(value, ['version', 'sourceSha256', 'status', 'analysisId', 'pollAfterSeconds'])
    || value.version !== SOURCE_PROTOCOL_VERSION || value.sourceSha256 !== pipeline.source.sha256 || value.status !== 'Pending'
    || value.analysisId !== pipeline.observation.submissionId || !validId(value.analysisId)
    || !Number.isSafeInteger(value.pollAfterSeconds) || value.pollAfterSeconds < 1 || value.pollAfterSeconds > 3600) {
    fail('VISION_SEMANTIC_STAGE_RESPONSE_INVALID');
  }
  return {
    version: SOURCE_PROTOCOL_VERSION, sourceSha256: pipeline.source.sha256, status: 'Pending',
    analysisId: pipeline.pipelineId, pollAfterSeconds: value.pollAfterSeconds,
  };
}
function semanticResult(value, pipeline, validate) {
  if (record(value) && value.status === 'Pending') return pending(value, pipeline);
  let observation;
  try { observation = validate(value, pipeline.source); }
  catch { fail('VISION_SEMANTIC_OBSERVATION_INVALID'); }
  if (observation.version !== OBSERVATION_VERSION || !TERMINAL_STATUSES.has(observation.status)
    || observation.sourceSha256 !== pipeline.source.sha256) fail('VISION_SEMANTIC_OBSERVATION_INVALID');
  return {
    version: RESULT_VERSION,
    sourceSha256: pipeline.source.sha256,
    status: observation.status,
    summary: observation.summary,
    observation,
  };
}

/**
 * Makes an adapter compatible with studio-vision's short submit/poll protocol.
 * Dependency injection is intentionally public so tests can prove protocol
 * behavior without importing credentials or contacting an MCP provider.
 */
export function createSemanticVisionAdapter(options = {}) {
  const stateDirectory = options.stateDirectory ?? configuredVisionStateDirectory;
  const submitStage = options.submitStage ?? mcpSubmitStage;
  const pollStage = options.pollStage ?? mcpPollStage;
  const validateInput = options.validateInput ?? validateStageInput;
  const buildInstruction = options.buildInstruction ?? buildObservationInstruction;
  const validate = options.validateObservation ?? validateObservation;
  const activeSubmissions = new Map();

  function checkedInput(input) {
    let checked;
    try { checked = validateInput(input); }
    catch { fail('VISION_SEMANTIC_INPUT_INVALID'); }
    if (!checked || !record(checked.source) || !validSource(sourceIdentity(checked.source))
      || !Number.isSafeInteger(checked.byteLength) || checked.byteLength < 1) fail('VISION_SEMANTIC_INPUT_INVALID');
    return { source: checked.source, byteLength: checked.byteLength };
  }
  async function getOrCreate(input) {
    const checked = checkedInput(input);
    const source = sourceIdentity(checked.source);
    let text;
    try { text = buildInstruction(source, checked.byteLength); }
    catch { fail('VISION_SEMANTIC_INSTRUCTION_INVALID'); }
    if (!instruction(text)) fail('VISION_SEMANTIC_INSTRUCTION_INVALID');
    const instructionDigest = digest(text);
    const fingerprint = digest(JSON.stringify({
      sourceProtocolVersion: SOURCE_PROTOCOL_VERSION, resultVersion: RESULT_VERSION, observationVersion: OBSERVATION_VERSION,
      source, instructionDigest,
    }));
    const candidate = {
      version: PIPELINE_RECORD_VERSION, kind: PIPELINE_KIND, pipelineId: randomUUID(),
      sourceProtocolVersion: SOURCE_PROTOCOL_VERSION, resultVersion: RESULT_VERSION, source,
      observation: { version: OBSERVATION_VERSION, submissionId: randomUUID(), instruction: text, instructionDigest },
    };
    let directory;
    try { directory = stateDirectory(); }
    catch (error) { throw error; }
    if (typeof directory !== 'string' || !directory) fail('MCP_SEMANTIC_STATE_DIRECTORY_INVALID');
    const created = await writeExclusiveJson(directory, gateFile(fingerprint), candidate);
    const saved = created ? candidate : await readJson(directory, gateFile(fingerprint));
    const pipeline = pipelineRecord(saved, saved?.pipelineId);
    if (!samePipelineDefinition(pipeline, candidate)) fail('MCP_SEMANTIC_RECORD_INVALID');
    const aliasCreated = await writeExclusiveJson(directory, pipelineFile(pipeline.pipelineId), pipeline);
    if (!aliasCreated) {
      const alias = pipelineRecord(await readJson(directory, pipelineFile(pipeline.pipelineId)), pipeline.pipelineId);
      if (!samePipeline(alias, pipeline)) fail('MCP_SEMANTIC_RECORD_INVALID');
    }
    return { directory, pipeline, input: { version: SOURCE_PROTOCOL_VERSION, source: checked.source } };
  }
  async function load(id) {
    if (!validId(id)) fail('MCP_ANALYSIS_ID_INVALID');
    let directory;
    try { directory = stateDirectory(); }
    catch (error) { throw error; }
    if (typeof directory !== 'string' || !directory) fail('MCP_SEMANTIC_STATE_DIRECTORY_INVALID');
    const value = await readJson(directory, pipelineFile(id));
    if (!value) fail('MCP_SEMANTIC_PIPELINE_UNKNOWN');
    return { directory, pipeline: pipelineRecord(value, id) };
  }
  async function storedStage(directory, pipeline) {
    const value = await readJson(directory, stageFile(pipeline.observation.submissionId));
    return value === undefined ? undefined : stageInput(value, pipeline, validateInput);
  }
  async function startObservation(input, pipeline, signal) {
    const id = pipeline.observation.submissionId;
    const active = activeSubmissions.get(id);
    if (active) return active;
    const work = Promise.resolve().then(() => submitStage(input, pipeline.observation.instruction, 'observation', { signal, submissionId: id }));
    activeSubmissions.set(id, work);
    try { return await work; }
    finally { activeSubmissions.delete(id); }
  }

  return {
    async submit(input, { signal } = {}) {
      const state = await getOrCreate(input);
      const stageId = state.pipeline.observation.submissionId;
      // An in-process submit has already reserved this immutable stage. It may
      // have written the producer record before its receipt exists, so joining
      // it prevents a concurrent POST from treating that brief interval as a
      // pollable task or opening a second submission.
      let active = activeSubmissions.get(stageId);
      const existing = active ? undefined : await storedStage(state.directory, state.pipeline);
      active ??= activeSubmissions.get(stageId);
      const observation = active
        ? await active
        : existing ? await pollStage(stageId, { signal }) : await startObservation(state.input, state.pipeline, signal);
      return semanticResult(observation, state.pipeline, validate);
    },
    async poll(analysisId, { signal } = {}) {
      const state = await load(analysisId);
      // Validate the persisted source, stage kind, payload and exact prompt
      // before reading it. Polling is intentionally incapable of submitting.
      await storedStage(state.directory, state.pipeline) ?? fail('MCP_SEMANTIC_STAGE_MISSING');
      const observation = await pollStage(state.pipeline.observation.submissionId, { signal });
      return semanticResult(observation, state.pipeline, validate);
    },
  };
}

const adapter = createSemanticVisionAdapter();
export const submit = adapter.submit;
export const poll = adapter.poll;
