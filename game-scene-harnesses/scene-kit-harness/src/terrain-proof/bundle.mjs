import { mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWithin, makeFreshDirectory, parseJson, portableReader, readSelectedFile, writeFreshFile } from '../files.mjs';
import { check, exact, hash, isDigest, jsonBytes, seal, unseal } from '../generation/common.mjs';
import { deriveTerrainProof, proofInventoryDigest } from './derive.mjs';
import { deriveTerrainProofRevision } from './revision.mjs';
import { deriveTerrainModuleStudy } from './modules.mjs';
import { deriveTerrainContinuityStudy } from './continuity.mjs';
import { deriveTerrainLongFieldStudy } from './long-field.mjs';
import { deriveReferenceField } from './reference-field.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export function proofFiles(raw, evidence) {
  return packageProof(raw, evidence, deriveTerrainProof(raw));
}
export function proofRevisionFiles(raw, evidence, parentBundleSha256) {
  check(isDigest(parentBundleSha256), 'PROOF_PARENT');
  return packageProof(raw, evidence, deriveTerrainProofRevision(raw), { parentBundleSha256,
    revisionKind: 'zero-generation-crop-and-material-variants', format: 'ai_scene_terrain_proof_bundle_v2' });
}
export function moduleStudyFiles(raw, evidence, parentBundleSha256) {
  check(isDigest(parentBundleSha256), 'PROOF_PARENT');
  return packageProof(raw, evidence, deriveTerrainModuleStudy(raw), { parentBundleSha256,
    revisionKind: 'zero-generation-derived-blob47-study', format: 'ai_scene_terrain_module_study_bundle_v1' });
}
export function continuityStudyFiles(raw, evidence, parentBundleSha256) {
  check(isDigest(parentBundleSha256), 'PROOF_PARENT');
  return packageProof(raw, evidence, deriveTerrainContinuityStudy(raw), { parentBundleSha256,
    revisionKind: 'zero-generation-continuous-material-study', format: 'ai_scene_terrain_continuity_study_bundle_v1' });
}
export function longFieldStudyFiles(raw, evidence, parentBundleSha256) {
  check(isDigest(parentBundleSha256), 'PROOF_PARENT');
  return packageProof(raw, evidence, deriveTerrainLongFieldStudy(raw), { parentBundleSha256,
    revisionKind: 'zero-generation-quilted-material-field-study', format: 'ai_scene_terrain_long_field_study_bundle_v1' });
}
export function referenceFieldStudyFiles(raw, evidence, parentBundleSha256) {
  check(isDigest(parentBundleSha256), 'PROOF_PARENT');
  return packageProof(raw, evidence, deriveReferenceField(raw), { parentBundleSha256,
    revisionKind: 'zero-generation-macro-rock-field', format: 'ai_scene_reference_field_bundle_v1' });
}
function packageProof(raw, evidence, derived, revision = {}) {
  exact(evidence, ['purpose', 'planSha256', 'requestSha256', 'rawSha256', 'technicalSha256']);
  check(['external-exchange', 'synthetic-simulation'].includes(evidence.purpose)
    && ['planSha256', 'requestSha256', 'rawSha256', 'technicalSha256'].every(key => isDigest(evidence[key]))
    && hash(raw) === evidence.rawSha256, 'PROOF_SOURCE_EVIDENCE');
  const { files, report } = derived;
  files.set('source/original.png', Buffer.from(raw));
  const bundle = seal({ format: 'ai_scene_terrain_proof_bundle_v1', ...revision, ...evidence,
    derivationSha256: report.sha256, inventorySha256: proofInventoryDigest(files),
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })),
    sourceRequiresSeparateVisualReview: true, productionKit: false, visualAcceptance: 'not-assessed' });
  files.set('proof-bundle.json', jsonBytes(bundle));
  return { files, report, bundle };
}

export function writeProofBundle(outputRoot, workflowRoot, prepared) {
  check(!isWithin(resolve(workflowRoot), resolve(outputRoot)), 'OUTPUT_OVERLAP');
  const output = makeFreshDirectory(outputRoot, sourceRoot);
  for (const [path, bytes] of prepared.files) {
    const target = join(output, path);
    mkdirSync(dirname(target), { recursive: true }); writeFreshFile(target, bytes, sourceRoot);
  }
  return prepared.bundle;
}

function scanProofBundle(outputRoot, expectedNames) {
  const names = [];
  const scan = (folder, prefix = '') => {
    check(lstatSync(folder).isDirectory() && !lstatSync(folder).isSymbolicLink(), 'PROOF_BUNDLE_PATH');
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      check(!entry.isSymbolicLink(), 'PROOF_BUNDLE_PATH');
      if (entry.isDirectory()) {
        check([...expectedNames].some(name => name.startsWith(`${path}/`)), 'PROOF_BUNDLE_INVENTORY');
        scan(join(folder, entry.name), `${path}/`);
      } else { check(entry.isFile(), 'PROOF_BUNDLE_PATH'); names.push(path); }
    }
  };
  scan(resolve(outputRoot));
  check(names.length === expectedNames.size && names.every(name => expectedNames.has(name)), 'PROOF_BUNDLE_INVENTORY');
}

// A sealed manifest can be read and verified in one pass when callers need the
// actual bytes as well. This is integrity verification, not derivation replay.
export function readManifestProofBundle(outputRoot) {
  const reader = portableReader(outputRoot), bundleBytes = reader.read('proof-bundle.json', 2097152), bundle = parseJson(bundleBytes);
  unseal(bundle);
  check(bundleBytes.equals(jsonBytes(bundle)), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  check(Array.isArray(bundle.artifacts) && bundle.artifacts.length > 0 && bundle.artifacts.length <= 8192, 'TERRAIN_BOTTOM_BASE_INVENTORY');
  const expected = new Set(['proof-bundle.json']);
  for (const item of bundle.artifacts) {
    exact(item, ['path', 'sha256', 'byteLength']);
    check(!expected.has(item.path), 'TERRAIN_BOTTOM_BASE_INVENTORY');
    expected.add(item.path);
  }
  scanProofBundle(outputRoot, expected);
  const files = new Map(); let total = 0;
  for (const item of bundle.artifacts) {
    const bytes = reader.read(item.path, 16777216); total += bytes.length;
    check(total <= 268435456 && bytes.length === item.byteLength && hash(bytes) === item.sha256, 'TERRAIN_BOTTOM_BASE_INVENTORY');
    files.set(item.path, bytes);
  }
  files.set('proof-bundle.json', bundleBytes);
  return {files, bundle};
}

export function verifyProofBundle(outputRoot, prepared) {
  readSelectedFile(join(outputRoot, 'proof-bundle.json'));
  scanProofBundle(outputRoot, new Set(prepared.files.keys()));
  for (const [path, expected] of prepared.files) {
    const bytes = readSelectedFile(join(outputRoot, path), 16777216);
    check(bytes.equals(expected), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  }
  return { format: 'ai_scene_terrain_proof_verification_v1', bundleSha256: prepared.bundle.sha256,
    verifiedFiles: prepared.files.size, status: 'deterministic-proof-valid', productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0 };
}
