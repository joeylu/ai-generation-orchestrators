import * as fs from 'node:fs';
import path from 'node:path';
import { createStoredZip } from '../../ui-panel-harness/src/zip-store.mjs';
import { canonical, exact, isDigest, isId, jsonBytes, local, readBytes, readJson, requireThat, sha256, textValue, verifyBlob, withLock, writeNew } from './common.mjs';
import { loadProject } from './project.mjs';
import { loadStyle, styleArtifacts, validateStyleDocument, verifyStyleSources } from './styles.mjs';
import { loadPrototype } from './panel.mjs';
import { verifyResult, verifyReview } from './generation.mjs';
import { decodePng } from './png.mjs';
import { verifyMapping, validateResolution } from './resolution.mjs';

function filesUnder(root, relative = '') {
  return fs.readdirSync(relative ? local(root, relative) : root).flatMap(name => {
    const child = relative ? `${relative}/${name}` : name, file = local(root, child), stat = fs.lstatSync(file);
    requireThat(!stat.isSymbolicLink(), 'PATH_LINK');
    return stat.isDirectory() ? filesUnder(root, child) : [child];
  }).sort();
}
export function exportProject(root, output, panelIds = null) {
  return withLock(root, () => {
    const project = loadProject(root); requireThat(project.activeStyle, 'PROJECT_STYLE_REQUIRED');
    const style = loadStyle(root, project.activeStyle), ids = panelIds ?? Object.keys(project.panels);
    requireThat(ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => Object.hasOwn(project.panels, id)), 'EXPORT_PANELS_INVALID');
    const files = new Map();
    files.set('style.json', jsonBytes(style));
    for (const artifact of styleArtifacts(style)) files.set(artifact.path, verifyBlob(root, artifact));
    for (const id of [...ids].sort()) {
      const entry = project.panels[id]; requireThat(entry.acceptedRun, 'EXPORT_PANEL_NOT_ACCEPTED');
      const result = verifyResult(root, entry.acceptedRun), review = verifyReview(root, entry.acceptedRun, result);
      requireThat(review.decision === 'accept' && result.plan.styleSha256 === project.activeStyle
        && result.plan.prototype.sha256 === entry.prototype.sha256, 'EXPORT_MIXED_STYLE_OR_STALE_PANEL');
      const prototype = loadPrototype(root, entry.prototype), prefix = `panels/${id}`;
      files.set(`${prefix}/reference.png`, result.reference);
      files.set(`${prefix}/prototype.png`, verifyBlob(root, prototype.layout));
      files.set(`${prefix}/prototype.json`, jsonBytes({ kind: 'ui_reference_public_prototype_v1', panelId: id,
        title: prototype.title, canvas: prototype.canvas, producer: prototype.producer,
        sourceSha256: prototype.source.sha256, prototypeSha256: entry.prototype.sha256,
        nodes: prototype.nodes, textPolicy: prototype.textPolicy, view: prototype.view }));
      files.set(`${prefix}/provenance.json`, jsonBytes({ kind: 'ui_reference_provenance_v2', panelId: id,
        planSha256: result.plan.sha256, prototypeSha256: entry.prototype.sha256, styleSha256: project.activeStyle,
        anchorSha256: result.plan.anchor?.image.sha256 ?? null, rawSha256: result.technical.rawSha256,
        imageSha256: result.technical.imageSha256, runtimeSha256: result.plan.runtimeSha256,
        resolution: result.plan.request.resolution, coordinateMapping: result.technical.coordinateMapping,
        rawSource: result.plan.rawSource ? { planSha256: result.plan.rawSource.planSha256,
          requestSha256: result.plan.rawSource.requestSha256, rawSha256: result.plan.rawSource.rawSha256 } : null,
        ...(result.plan.correction ? { correction: { kind: result.plan.correction.kind, planSha256: result.plan.correction.planSha256,
          image: result.plan.correction.image, targetIds: result.plan.correction.targetIds } } : {}),
        ...(result.plan.revision ? { revision: { kind: result.plan.revision.kind, planSha256: result.plan.revision.planSha256,
          image: result.plan.revision.image, round: result.plan.revision.round, note: result.plan.revision.note } } : {}),
        postProcess: result.technical.postProcess, visualReview: { layout: review.layout, style: review.style, copy: review.copy, decision: review.decision } }));
      files.set(`${prefix}/handoff.json`, jsonBytes({ kind: 'ui_reference_handoff_v2', panelId: id,
        reference: { path: 'reference.png', sha256: result.technical.imageSha256, bytes: result.reference.length },
        canvas: result.technical.dimensions, logicalCanvas: prototype.canvas,
        resolution: result.plan.request.resolution, coordinateMapping: result.technical.coordinateMapping,
        styleSha256: project.activeStyle, humanVisualReview: 'accepted',
        target: 'ui-layer-harness', textPolicy: 'reference-preserves-copy-consumer-applies-own-text-policy' }));
      if (result.plan.anchor) files.set(result.plan.anchor.image.path, verifyBlob(root, result.plan.anchor.image));
      if (result.plan.correction) files.set(result.plan.correction.image.path, verifyBlob(root, result.plan.correction.image));
      if (result.plan.revision) files.set(result.plan.revision.image.path, verifyBlob(root, result.plan.revision.image));
    }
    const records = [...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) }));
    const manifest = { kind: 'ui_reference_delivery_v2', projectId: project.id, styleSha256: project.activeStyle,
      panelIds: [...ids].sort(), files: records, visualReview: 'accepted', pixelIdentityAcrossPanels: 'NOT_CLAIMED' };
    files.set('manifest.json', jsonBytes(manifest));
    const zip = Buffer.from(createStoredZip(files));
    requireThat(!fs.existsSync(output), 'OUTPUT_ALREADY_EXISTS');
    // Validate every existing ancestor before creating a fresh output directory.
    let ancestor = path.resolve(output);
    while (true) {
      requireThat(!fs.existsSync(ancestor) || !fs.lstatSync(ancestor).isSymbolicLink(), 'PATH_LINK');
      const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
    }
    fs.mkdirSync(output, { recursive: true });
    for (const [name, bytes] of files) writeNew(output, name, bytes);
    writeNew(output, 'references.zip', zip);
    validateDelivery(output);
    return { panelIds: manifest.panelIds, styleSha256: project.activeStyle, zipSha256: sha256(zip), status: 'exported' };
  });
}
export function validateDelivery(output) {
  const manifest = readJson(local(output, 'manifest.json'));
  exact(manifest, ['kind', 'projectId', 'styleSha256', 'panelIds', 'files', 'visualReview', 'pixelIdentityAcrossPanels']);
  requireThat(manifest.kind === 'ui_reference_delivery_v2' && manifest.visualReview === 'accepted'
    && isId(manifest.projectId) && isDigest(manifest.styleSha256)
    && manifest.pixelIdentityAcrossPanels === 'NOT_CLAIMED'
    && Array.isArray(manifest.panelIds) && manifest.panelIds.length > 0 && manifest.panelIds.every(isId)
    && new Set(manifest.panelIds).size === manifest.panelIds.length, 'DELIVERY_CONTRACT');
  const files = new Map(), names = new Set();
  for (const record of manifest.files) {
    exact(record, ['path', 'sha256', 'bytes']);
    requireThat(!names.has(record.path.toLowerCase()) && !['manifest.json', 'references.zip'].includes(record.path), 'MANIFEST_DUPLICATE');
    names.add(record.path.toLowerCase());
    const bytes = readBytes(local(output, record.path));
    requireThat(record.bytes === bytes.length && record.sha256 === sha256(bytes), 'DELIVERY_CHECKSUM');
    files.set(record.path, bytes);
  }
  const style = validateStyleDocument(readJson(local(output, 'style.json'))), allowed = new Set(['style.json']);
  const { sha256: styleDigest, ...stylePayload } = style;
  requireThat(sha256(jsonBytes(stylePayload)) === styleDigest && styleDigest === manifest.styleSha256, 'DELIVERY_STYLE_MISMATCH');
  for (const item of style.references) {
    allowed.add(item.artifact.path);
    const bytes = files.get(item.artifact.path);
    requireThat(bytes && sha256(bytes) === item.artifact.sha256 && bytes.length === item.artifact.bytes, 'DELIVERY_STYLE_REFERENCE'); decodePng(bytes);
  }
  verifyStyleSources(style, artifact => files.get(artifact.path));
  for (const artifact of styleArtifacts(style)) allowed.add(artifact.path);
  for (const id of manifest.panelIds) {
    const prefix = `panels/${id}`, reference = files.get(`${prefix}/reference.png`);
    requireThat(reference, 'DELIVERY_PANEL_MISSING');
    const image = decodePng(reference), provenance = readJson(local(output, `${prefix}/provenance.json`));
    const handoff = readJson(local(output, `${prefix}/handoff.json`)), prototype = readJson(local(output, `${prefix}/prototype.json`));
    exact(provenance, ['kind', 'panelId', 'planSha256', 'prototypeSha256', 'styleSha256', 'anchorSha256', 'rawSha256', 'imageSha256', 'runtimeSha256', 'resolution', 'coordinateMapping', 'rawSource', 'postProcess', 'visualReview'], ['correction', 'revision']);
    exact(handoff, ['kind', 'panelId', 'reference', 'canvas', 'logicalCanvas', 'resolution', 'coordinateMapping', 'styleSha256', 'humanVisualReview', 'target', 'textPolicy']);
    exact(handoff.reference, ['path', 'sha256', 'bytes']);
    exact(prototype, ['kind', 'panelId', 'title', 'canvas', 'producer', 'sourceSha256', 'prototypeSha256', 'nodes', 'textPolicy', 'view']);
    exact(prototype.producer, ['kind', 'panelSpecVersion', 'compilerVersion', 'bundleSha256']);
    requireThat(provenance.kind === 'ui_reference_provenance_v2' && prototype.kind === 'ui_reference_public_prototype_v1'
      && handoff.kind === 'ui_reference_handoff_v2' && prototype.panelId === id
      && prototype.prototypeSha256 === provenance.prototypeSha256 && prototype.producer.kind === 'ui-panel-harness'
      && handoff.target === 'ui-layer-harness' && handoff.humanVisualReview === 'accepted'
      && handoff.textPolicy === 'reference-preserves-copy-consumer-applies-own-text-policy'
      && provenance.postProcess === 'png-metadata-strip-lossless-rgba-v1'
      && provenance.panelId === id && provenance.styleSha256 === manifest.styleSha256
      && provenance.imageSha256 === sha256(reference) && canonical(provenance.visualReview) === canonical({ layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept' })
      && handoff.panelId === id && handoff.styleSha256 === manifest.styleSha256 && handoff.reference.path === 'reference.png'
      && handoff.reference.sha256 === provenance.imageSha256 && handoff.reference.bytes === reference.length
      && canonical(handoff.logicalCanvas) === canonical(prototype.canvas)
      && canonical(handoff.canvas) === canonical({ width: image.width, height: image.height })
      && canonical(handoff.resolution) === canonical(provenance.resolution)
      && canonical(handoff.coordinateMapping) === canonical(provenance.coordinateMapping), 'DELIVERY_PANEL_MISMATCH');
    validateResolution(provenance.resolution);
    verifyMapping(provenance.coordinateMapping, prototype.canvas, handoff.canvas, provenance.resolution);
    if (provenance.rawSource !== null) {
      exact(provenance.rawSource, ['planSha256', 'requestSha256', 'rawSha256']);
      requireThat(Object.values(provenance.rawSource).every(isDigest)
        && provenance.rawSource.rawSha256 === provenance.rawSha256 && provenance.resolution.mode === 'native', 'DELIVERY_RAW_SOURCE');
    }
    if (Object.hasOwn(provenance, 'correction')) {
      const correction = provenance.correction;
      exact(correction, ['kind', 'planSha256', 'image', 'targetIds']); exact(correction.image, ['path', 'sha256', 'bytes']);
      const bytes = files.get(correction.image.path);
      requireThat(correction.kind === 'ui_reference_select_correction_v1' && provenance.rawSource === null
        && isDigest(correction.planSha256) && correction.planSha256 !== provenance.planSha256
        && isDigest(correction.image.sha256) && correction.image.path === `blobs/${correction.image.sha256}.png`
        && bytes && bytes.length === correction.image.bytes && sha256(bytes) === correction.image.sha256
        && Array.isArray(correction.targetIds) && correction.targetIds.length > 0 && correction.targetIds.length <= 32
        && new Set(correction.targetIds).size === correction.targetIds.length
        && correction.targetIds.every(target => prototype.nodes.some(node => node.id === target && node.type === 'Select')), 'DELIVERY_CORRECTION_SOURCE');
      decodePng(bytes); allowed.add(correction.image.path);
    }
    if (Object.hasOwn(provenance, 'revision')) {
      const revision = provenance.revision;
      exact(revision, ['kind', 'planSha256', 'image', 'round', 'note']); exact(revision.image, ['path', 'sha256', 'bytes']);
      textValue(revision.note, 8000);
      const bytes = files.get(revision.image.path);
      requireThat(revision.kind === 'ui_reference_revision_v1' && !provenance.correction && provenance.rawSource === null
        && isDigest(revision.planSha256) && revision.planSha256 !== provenance.planSha256
        && Number.isInteger(revision.round) && revision.round >= 1 && revision.round <= 3
        && isDigest(revision.image.sha256) && revision.image.path === `blobs/${revision.image.sha256}.png`
        && bytes && bytes.length === revision.image.bytes && sha256(bytes) === revision.image.sha256, 'DELIVERY_REVISION_SOURCE');
      decodePng(bytes); allowed.add(revision.image.path);
    }
    for (let p = 3; p < image.rgba.length; p += 4) requireThat(image.rgba[p] === 255, 'DELIVERY_NOT_OPAQUE');
    const layout = decodePng(files.get(`${prefix}/prototype.png`));
    requireThat(layout.width === prototype.canvas.width && layout.height === prototype.canvas.height, 'DELIVERY_PROTOTYPE_SIZE');
    for (const file of ['reference.png', 'prototype.png', 'prototype.json', 'provenance.json', 'handoff.json']) allowed.add(`${prefix}/${file}`);
    if (provenance.anchorSha256 !== null) {
      requireThat(isDigest(provenance.anchorSha256), 'DELIVERY_ANCHOR');
      const anchorPath = `blobs/${provenance.anchorSha256}.png`, bytes = files.get(anchorPath);
      requireThat(bytes && sha256(bytes) === provenance.anchorSha256, 'DELIVERY_ANCHOR'); allowed.add(anchorPath); decodePng(bytes);
    }
  }
  requireThat(canonical([...files.keys()].sort()) === canonical([...allowed].sort()), 'DELIVERY_UNEXPECTED_PAYLOAD');
  files.set('manifest.json', readBytes(local(output, 'manifest.json')));
  requireThat(canonical(filesUnder(output)) === canonical([...files.keys(), 'references.zip'].sort()), 'DELIVERY_EXTRA_OR_MISSING_FILE');
  requireThat(Buffer.from(createStoredZip(files)).equals(readBytes(local(output, 'references.zip'))), 'DELIVERY_ZIP_MISMATCH');
  return { status: 'valid', panelCount: manifest.panelIds.length, styleSha256: manifest.styleSha256 };
}
