import { fileURLToPath } from 'node:url';
import { check, exact, hash, id, jsonBytes, seal, text, unseal } from './generation/common.mjs';
import { validateFlexibleBlueprint, flexibleBlueprintGuide } from './reference-layout.mjs';
import { writeProofBundle, verifyProofBundle } from './terrain-proof/bundle.mjs';

const points = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function range(value, low, high) {
  exact(value, ['min', 'max']);
  check(Number.isInteger(value.min) && Number.isInteger(value.max) && value.min >= low && value.max <= high && value.min <= value.max, 'COMPOSITION_RANGE');
}
function randomFor(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function overlap(a, b, distance) {
  return a.x < b.x + b.width + distance && a.x + a.width + distance > b.x
    && a.y < b.y + b.height + distance && a.y + a.height + distance > b.y;
}
// The Agent authors this structured intent from the user's content/gameplay
// requirements. This compiler does no keyword-to-theme or image understanding.
// It searches placements under explicit ranges instead of loading a snow layout.
export function composeReferenceBlueprint(intent) {
  const i = unseal(intent);
  exact(i, ['format', 'designId', 'sceneDescription', 'viewport', 'seed', 'layers', 'hardInstances', 'artSubjects', 'protectedRegions', 'tolerances', 'composition']);
  check(i.format === 'ai_scene_composition_intent_v1', 'COMPOSITION_FORMAT'); id(i.designId); text(i.sceneDescription, { limit: 2000 });
  check(Number.isInteger(i.seed) && i.seed >= 0 && i.seed <= 0xffffffff, 'COMPOSITION_SEED');
  exact(i.viewport, ['width', 'height']);
  check(Number.isInteger(i.viewport.width) && Number.isInteger(i.viewport.height) && i.viewport.width >= 256 && i.viewport.width <= 2048
    && i.viewport.height >= 144 && i.viewport.height <= 1152 && i.viewport.width > i.viewport.height
    && i.viewport.width * i.viewport.height <= 2097152, 'BLUEPRINT_FRAME');
  check(Array.isArray(i.layers) && Array.isArray(i.hardInstances) && Array.isArray(i.artSubjects)
    && Array.isArray(i.protectedRegions) && i.hardInstances.length + i.artSubjects.length > 0
    && i.hardInstances.length + i.artSubjects.length <= 24, 'COMPOSITION_INSTANCES');
  exact(i.composition, ['mass', 'minimumSeparationPx', 'shapeLanguage']);
  check(['airy', 'balanced', 'dense'].includes(i.composition.mass) && Number.isInteger(i.composition.minimumSeparationPx)
    && i.composition.minimumSeparationPx >= 0 && i.composition.minimumSeparationPx <= 128, 'COMPOSITION_STYLE');
  text(i.composition.shapeLanguage, { limit: 1000 });
  const ids = new Set();
  for (const row of [...i.hardInstances, ...i.artSubjects]) { id(row.instanceId); check(!ids.has(row.instanceId), 'BLUEPRINT_DUPLICATE'); ids.add(row.instanceId); }
  const instances = i.hardInstances.map(row => {
    exact(row, ['instanceId', 'layerId', 'role', 'content', 'polygon', 'anchor']); return { ...row, constraint: { mode: 'hard' } };
  });
  const draw = randomFor(i.seed), integer = (min, max) => min + Math.floor(draw() * (max - min + 1));
  const frame = i.viewport, placements = [];
  for (const subject of i.artSubjects) {
    exact(subject, ['instanceId', 'layerId', 'role', 'content', 'placement', 'occupancyPermille', 'maxOutsidePermille', 'anchorBandPermille']);
    id(subject.role); text(subject.content, { limit: 1500 });
    exact(subject.placement, ['side', 'vertical', 'widthPermille', 'heightPermille', 'topPermille']);
    check(['left', 'right', 'center', 'wide', 'auto', 'frame-left', 'frame-right'].includes(subject.placement.side)
      && ['free', 'frame-bottom'].includes(subject.placement.vertical), 'COMPOSITION_SIDE');
    range(subject.placement.widthPermille, 10, 1000); range(subject.placement.heightPermille, 10, 1000);
    range(subject.placement.topPermille, 0, 990); range(subject.occupancyPermille, 1, 1000);
    check(subject.placement.vertical !== 'frame-bottom' || subject.placement.topPermille.min === 0 && subject.placement.topPermille.max === 0, 'COMPOSITION_VERTICAL');
    range(subject.anchorBandPermille, 0, 1000);
    check(subject.anchorBandPermille.max > subject.anchorBandPermille.min, 'COMPOSITION_ANCHOR_BAND');
    check(Number.isInteger(subject.maxOutsidePermille) && subject.maxOutsidePermille >= 0 && subject.maxOutsidePermille <= 50, 'ART_REGION_OCCUPANCY');
    let selected = null;
    for (let attempt = 0; attempt < 64; attempt++) {
      const width = Math.max(2, Math.round(frame.width * integer(subject.placement.widthPermille.min, subject.placement.widthPermille.max) / 1000));
      const height = Math.max(2, Math.round(frame.height * integer(subject.placement.heightPermille.min, subject.placement.heightPermille.max) / 1000));
      const y = subject.placement.vertical === 'frame-bottom' ? frame.height - height
        : Math.round(frame.height * integer(subject.placement.topPermille.min, subject.placement.topPermille.max) / 1000);
      if (height + y > frame.height) continue;
      let minX = 0, maxX = frame.width - width;
      if (subject.placement.side === 'left') maxX = Math.floor(frame.width / 2) - width;
      if (subject.placement.side === 'right') minX = Math.ceil(frame.width / 2);
      if (subject.placement.side === 'frame-left') minX = maxX = 0;
      if (subject.placement.side === 'frame-right') minX = maxX = frame.width - width;
      if (subject.placement.side === 'center' || subject.placement.side === 'wide') {
        const slack = subject.placement.side === 'wide' ? 0 : Math.round(frame.width * 0.06);
        minX = Math.max(0, Math.floor((frame.width - width) / 2) - slack);
        maxX = Math.min(frame.width - width, Math.ceil((frame.width - width) / 2) + slack);
      }
      if (maxX < minX) continue;
      const x = integer(minX, maxX), box = { x, y, width, height };
      if (placements.some(p => p.layerId === subject.layerId && overlap(p.box, box, i.composition.minimumSeparationPx))) continue;
      const minY = y + Math.floor(height * subject.anchorBandPermille.min / 1000);
      const maxY = y + Math.ceil(height * subject.anchorBandPermille.max / 1000);
      const spread = subject.occupancyPermille.max - subject.occupancyPermille.min;
      const maxOccupancyPermille = i.composition.mass === 'airy' ? subject.occupancyPermille.min + Math.floor(spread * 0.65) : subject.occupancyPermille.max;
      const minOccupancyPermille = i.composition.mass === 'dense' ? subject.occupancyPermille.min + Math.floor(spread * 0.35) : subject.occupancyPermille.min;
      const candidate = { instanceId: subject.instanceId, layerId: subject.layerId, role: subject.role, content: subject.content,
        constraint: { mode: 'art-region', region: points(x, y, width, height), anchorRegion: points(x, minY, width, Math.max(1, maxY - minY)),
          minOccupancyPermille, maxOccupancyPermille, maxOutsidePermille: subject.maxOutsidePermille, shapeIntent: i.composition.shapeLanguage } };
      // Validate candidate capacity with only the protected regions that refer to
      // already placed instances. The final pass validates the complete design.
      const placed = [...instances, candidate], known = new Set(placed.map(i => i.instanceId));
      const regions = i.protectedRegions.map(r => ({ ...r, forbiddenInstanceIds: r.forbiddenInstanceIds.filter(id => known.has(id)) }))
        .filter(r => r.forbiddenInstanceIds.length);
      const partial = { format: 'ai_scene_reference_blueprint_v2', blueprintId: i.designId, sceneDescription: i.sceneDescription, projection: 'pure-sideview',
        viewport: frame, layers: i.layers.filter(l => placed.some(p => p.layerId === l.layerId)), instances: placed, protectedRegions: regions, tolerances: i.tolerances };
      try { validateFlexibleBlueprint(seal(partial)); } catch (error) {
        if (error.errors?.some(e => e.code === 'ART_REGION_NO_CAPACITY' || e.code === 'BLUEPRINT_PROTECTED_OVERLAP')) continue;
        throw error;
      }
      selected = candidate; placements.push({ instanceId: candidate.instanceId, layerId: candidate.layerId, box }); break;
    }
    check(selected, 'COMPOSITION_UNSATISFIABLE', 'No legal placement under the explicit scene ranges; change the design, not its constraints.');
    instances.push(selected);
  }
  const blueprint = seal({ format: 'ai_scene_reference_blueprint_v2', blueprintId: i.designId, sceneDescription: i.sceneDescription, projection: 'pure-sideview',
    viewport: frame, layers: i.layers, instances, protectedRegions: i.protectedRegions, tolerances: i.tolerances });
  validateFlexibleBlueprint(blueprint);
  return seal({ format: 'ai_scene_composition_proposal_v1', intentSha256: intent.sha256, blueprint,
    planner: 'bounded-seeded-region-placement-v1', languageInterpretation: 'agent-authored-structured-intent',
    styleImageGeometryUsed: false, artSilhouettesSelected: false, placements: placements.map(p => ({ instanceId: p.instanceId, regionBounds: p.box })),
    hardInstanceIds: instances.filter(i => i.constraint.mode === 'hard').map(i => i.instanceId), generationCalls: 0, executable: false });
}
function proposalFiles(intent) {
  const proposal = composeReferenceBlueprint(intent), guide = flexibleBlueprintGuide(proposal.blueprint);
  const files = new Map([['intent.json', jsonBytes(intent)], ['composition-proposal.json', jsonBytes(proposal)],
    ['blueprint.json', jsonBytes(proposal.blueprint)], ['layout-guide.png', guide.bytes],
    ['guide-legend.txt', Buffer.from('Solid fill: hard gameplay geometry. Dashed envelope: soft art placement region, not an object silhouette.\nNo images generated; design and actual reference remain unaccepted.\n')]]);
  const bundle = seal({ format: 'ai_scene_composition_design_bundle_v1', intentSha256: intent.sha256, proposalSha256: proposal.sha256,
    blueprintSha256: proposal.blueprint.sha256, artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })),
    executable: false, generationCalls: 0 });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report: proposal, bundle };
}
export const buildCompositionProposal = (intent, output) => writeProofBundle(output, fileURLToPath(new URL('../', import.meta.url)), proposalFiles(intent));
export const verifyCompositionProposal = (intent, output) => verifyProofBundle(output, proposalFiles(intent));
