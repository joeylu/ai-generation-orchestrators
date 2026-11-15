import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { validateDocument } from './schema.mjs';
import { inspectPng } from './png.mjs';
import {supportsModuleRenderStyle} from './render-style.mjs';
import { validateTerrainSkinModule } from './terrain-skins.mjs';
import { PROFILE, SIGNATURES } from './topology.mjs';
import { InvalidKit, demand, reject, uniqueIds } from './errors.mjs';
import { createSceneSemantics } from './semantics.mjs';
import { portablePath } from './files.mjs';
import { SNOW_SURFACE_SHA256 } from './terrain-proof/snow-profile.mjs';
import { JOINED_FIELD_SHA256 } from './terrain-proof/joined-field.mjs';
import { MEASURED_FIELD_SHA256 } from './terrain-proof/measured-field.mjs';
import { MEASURED_FIELD_DENSITY2_SHA256 } from './terrain-proof/measured-field-density.mjs';
import { validateTerrainEdges, terrainEdgeSources } from './terrain-edges.mjs';
import { validateTerrainMaterialLoop } from './terrain-material-loop.mjs';
import { validateTerrainRigidRepeat } from './terrain-rigid-repeat.mjs';
import { validateTerrainStepCorners } from './terrain-step-corners.mjs';
import {validateTerrainBottomEdges,terrainBottomEdgeSources} from './terrain-bottom-edges.mjs';
import {validateSharedTerrainFieldProfile,supportsSharedTerrainAppearance} from './shared-terrain-field.mjs';
import {resolveTerrainMaterialAppearance,resolveTerrainSurfaceInterface} from './terrain-loop-material.mjs';
import {validateTerrainSurfaceCycle} from './terrain-surface-cycle.mjs';
import {validateTerrainSurfaceSpanProfile} from './terrain-surface-span-envelope.mjs';
import {validateTerrainStepSurface} from './terrain-step-surface.mjs';
import { checkEnvironmentAnimationAtlas, measureEnvironmentAnimationAtlasBaseLock, measureEnvironmentAnimationRegistration,
  validateEnvironmentAnimation } from './environment-animation-media.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function directoryBundleReader(inputRoot) {
  let root;
  try {
    demand(!lstatSync(inputRoot).isSymbolicLink() && lstatSync(inputRoot).isDirectory(), 'PATH_UNSAFE', 'kit.json', '/', 'Bundle root must be a regular directory');
    root = realpathSync(inputRoot);
  } catch (error) {
    if (error instanceof InvalidKit) throw error;
    reject('ROOT_UNAVAILABLE', 'kit.json', '/', 'Cannot read the selected bundle directory');
  }
  const outside = target => {
    const local = relative(root, target);
    return isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`);
  };
  const read = (name, limit) => {
    const target = resolve(root, ...name.split('/'));
    demand(!outside(target), 'PATH_UNSAFE', 'kit.json', '/', 'Artifact must remain inside the bundle');
    try {
      let current = root;
      for (const segment of name.split('/')) {
        current = resolve(current, segment);
        demand(!lstatSync(current).isSymbolicLink(), 'PATH_UNSAFE', name, '/', 'Symbolic links and junctions are not permitted');
      }
      const stat = lstatSync(target);
      demand(stat.isFile() && !outside(realpathSync(target)), 'PATH_UNSAFE', name, '/', 'Artifact must be a regular file inside the bundle');
      demand(stat.size <= limit, 'RESOURCE_LIMIT', name, '/', 'Artifact exceeds the bounded input size');
      return readFileSync(target);
    } catch (error) {
      if (error instanceof InvalidKit) throw error;
      reject('FILE_UNAVAILABLE', name, '/', 'Required bundle file cannot be read');
    }
  };
  return { root, read };
}

function inspectBundle({ root, read }, snapshot = false) {
  const verifiedFiles = new Map();
  const readSafe = (name, limit = 2097152) => {
    demand(portablePath(name), 'PATH_UNSAFE', 'kit.json', '/', 'Only portable relative file paths are permitted');
    const bytes = read(name, limit);
    demand(Buffer.isBuffer(bytes), 'FILE_UNAVAILABLE', name, '/', 'Required bundle file cannot be read');
    demand(bytes.length <= limit, 'RESOURCE_LIMIT', name, '/', 'Artifact exceeds the bounded input size');
    if (verifiedFiles.has(name)) demand(verifiedFiles.get(name).equals(bytes), 'SOURCE_CHANGED', name, '/', 'Source changed during snapshot verification');
    else verifiedFiles.set(name, bytes);
    return bytes;
  };
  const load = (name, format, expectedHash) => {
    demand(name.endsWith('.json'), 'PATH_UNSAFE', 'kit.json', '/', 'Contract documents must use .json');
    const bytes = readSafe(name);
    if (expectedHash) demand(sha256(bytes) === expectedHash, 'CHECKSUM_MISMATCH', name, '/', 'Document SHA-256 differs from its bundle reference');
    let document;
    try { document = JSON.parse(bytes.toString('utf8')); } catch { reject('JSON_INVALID', name, '/', 'Malformed JSON document'); }
    const selected = Array.isArray(format) ? format.includes(document?.format) ? document.format : format[0] : format;
    const errors = validateDocument(selected, document);
    if (errors.length) throw new InvalidKit(errors.map(error => ({ artifact: name, ...error })));
    return document;
  };
  const kit = load('kit.json', ['ai_scene_kit_v1', 'ai_scene_kit_v2', 'ai_scene_kit_v3', 'ai_scene_kit_v4']);
  const macro = ['ai_scene_kit_v3', 'ai_scene_kit_v4'].includes(kit.format), continuous = macro || kit.format === 'ai_scene_kit_v2';
  const refs = kit.files;
  const referencedFiles = [refs.catalog, refs.rules, refs.presets, refs.maps.default, refs.maps.inspection];
  demand(new Set(['kit.json', ...referencedFiles.map(item => item.path)]).size === 6, 'DOCUMENT_ALIAS', 'kit.json', '/files', 'Each document role must reference a distinct file');
  const catalog = load(refs.catalog.path, kit.format === 'ai_scene_kit_v4' ? 'ai_scene_module_catalog_v4' : macro ? 'ai_scene_module_catalog_v3' : kit.format === 'ai_scene_kit_v2'
    ? ['ai_scene_module_catalog_v1', 'ai_scene_module_catalog_v2'] : 'ai_scene_module_catalog_v1', refs.catalog.sha256);
  const rules = load(refs.rules.path, 'ai_scene_terrain_rules_v1', refs.rules.sha256);
  const library = load(refs.presets.path, 'ai_scene_assembly_presets_v1', refs.presets.sha256);
  const checkKitRef = (document, artifact) => demand(
    document.kitRef.kitId === kit.kitId && document.kitRef.revision === kit.revision,
    'KIT_REVISION_MISMATCH', artifact, '/kitRef', 'Document is bound to a different kit revision',
  );
  for (const [document, artifact] of [[catalog, refs.catalog.path], [rules, refs.rules.path], [library, refs.presets.path]]) checkKitRef(document, artifact);
  const density = kit.pixelsPerUnit.numerator / kit.pixelsPerUnit.denominator;
  const coreWidth = kit.grid.width * density, coreHeight = kit.grid.height * density;
  demand(Number.isInteger(coreWidth) && Number.isInteger(coreHeight), 'GRID_PIXEL_ALIGNMENT', 'kit.json', '/pixelsPerUnit', 'Logical grid must map to whole source pixels');
  uniqueIds(catalog.modules, 'assetId', refs.catalog.path, '/modules');
  const modules = new Map(catalog.modules.map(module => [module.assetId, module]));
  let sourceBytes = 0, declaredPixels = 0;
  const pngCache = new Map();
  const checkedAnimationGrids = new Map();
  const checkedRegistrations = new Map();
  const checkedBaseLocks = new Map();
  const animationSources = new Set();
  catalog.modules.forEach((module, index) => {
    const at = `/modules/${index}`;
    if (module.renderStyle) {
      demand(supportsModuleRenderStyle(module,kit.format),
        'MODULE_RENDER_STYLE', refs.catalog.path, at, 'Only environment styles or fully opaque white-tinted v4 background display scaling are supported');
    }
    declaredPixels += module.pixelSize.width * module.pixelSize.height;
    demand(declaredPixels <= 67108864, 'RESOURCE_LIMIT', refs.catalog.path, '/modules', 'Total declared pixel count exceeds the decode budget');
    demand(module.source.path.endsWith('.png'), 'PNG_REQUIRED', refs.catalog.path, `${at}/source/path`, 'Module sources must be PNG files');
    const bytes = readSafe(module.source.path, 16777216);
    sourceBytes += bytes.length;
    demand(sourceBytes <= 134217728, 'RESOURCE_LIMIT', refs.catalog.path, '/modules', 'Total module source bytes exceed the validation budget');
    demand(bytes.length === module.source.byteLength, 'BYTE_LENGTH_MISMATCH', refs.catalog.path, `${at}/source/byteLength`, 'Source byte count differs from the declaration');
    const digest = sha256(bytes);
    demand(digest === module.source.sha256, 'CHECKSUM_MISMATCH', refs.catalog.path, `${at}/source/sha256`, 'PNG SHA-256 differs from its declaration');
    let image = pngCache.get(digest);
    if (!image) {
      try { image = inspectPng(bytes); } catch (error) { reject('PNG_INVALID', module.source.path, '/', error.message); }
      pngCache.set(digest, image);
    }
    demand(image.width === module.pixelSize.width && image.height === module.pixelSize.height, 'PNG_DIMENSIONS', refs.catalog.path, `${at}/pixelSize`, 'Actual PNG dimensions differ from the declared dimensions');
    demand(image.nonzeroAlphaPixels > 0, 'PNG_EMPTY', module.source.path, '/', 'A module cannot contain only transparent pixels');
    demand(module.anchorPx.x >= 0 && module.anchorPx.y >= 0 && module.anchorPx.x < image.width && module.anchorPx.y < image.height, 'ANCHOR_BOUNDS', refs.catalog.path, `${at}/anchorPx`, 'Pixel anchor must lie inside the PNG canvas');
    demand((module.kind === 'strip') === (module.repeatAxis === 'x'), 'REPEAT_AXIS', refs.catalog.path, `${at}/repeatAxis`, 'Only a strip declares horizontal repeat');
    if (module.kind === 'terrain') {
      demand(module.footprint.columns === 1 && module.footprint.rows === 1
        && module.visualOffset.x === 0 && module.visualOffset.y === 0,
      'TERRAIN_GEOMETRY', refs.catalog.path, at, 'Terrain modules occupy one logical cell with no visual origin offset');
      demand(module.anchorPx.x + coreWidth <= image.width && module.anchorPx.y + coreHeight <= image.height,
        'TERRAIN_CORE_BOUNDS', refs.catalog.path, at, 'PNG must contain the declared cell core from its anchor');
    } else if (module.kind === 'environment') {
      demand(image.transparentPixels > 0, 'ALPHA_REQUIRED', module.source.path, '/', 'Environment modules require transparent pixels');
    } else if (module.kind === 'background') {
      demand(image.transparentPixels === 0, 'OPAQUE_REQUIRED', module.source.path, '/', 'Background modules require an opaque canvas');
    }
    demand(module.placementRole === undefined || (module.kind === 'environment' && !module.terrainSkin),
      'ENVIRONMENT_PLACEMENT_ROLE', refs.catalog.path, at, 'Placement role requires an ordinary environment sprite');
    if (module.terrainSkin) validateTerrainSkinModule(module, kit, inspectPng(bytes, { includePixels: true }), refs.catalog.path, at);
    if (module.animation) {
      validateEnvironmentAnimation(module, refs.catalog.path, at);
      for (const { clip } of module.animation.states) {
        if (!clip) continue;
        const { source, columns, rows, frameSize } = clip;
        const key = `${source.sha256}/${columns}/${rows}`;
        let atlas = checkedAnimationGrids.get(key);
        if (!atlas) {
          const media = readSafe(source.path, 16777216);
          demand(sha256(media) === source.sha256, 'CHECKSUM_MISMATCH', source.path, '/', 'Animation PNG checksum differs');
          declaredPixels += frameSize.width * frameSize.height * columns * rows;
          if (!animationSources.has(source.path)) { sourceBytes += media.length; animationSources.add(source.path); }
          demand(sourceBytes <= 134217728 && declaredPixels <= 67108864, 'RESOURCE_LIMIT', refs.catalog.path, at, 'Animation exceeds kit byte or pixel budget');
          atlas = checkEnvironmentAnimationAtlas(media, clip, source.path);
          checkedAnimationGrids.set(key, atlas);
        }
        demand(verifiedFiles.get(source.path).length === source.byteLength, 'BYTE_LENGTH_MISMATCH', source.path, '/', 'Animation PNG byte count differs');
        demand(atlas.frameSize.width === frameSize.width && atlas.frameSize.height === frameSize.height,
          'ANIMATION_FRAME_SIZE', source.path, '/', 'Animation frame size differs from its atlas grid');
        if (clip.registration) {
          const registrationKey = `${module.source.sha256}/${key}`;
          if (!checkedRegistrations.has(registrationKey)) checkedRegistrations.set(registrationKey,
            measureEnvironmentAnimationRegistration(bytes, verifiedFiles.get(source.path), clip));
          const registration = checkedRegistrations.get(registrationKey);
          demand(registration && ['scale', 'x', 'y'].every(field => registration[field] === clip.registration[field]),
            'ANIMATION_REGISTRATION', source.path, '/', 'Animation registration differs from its source and first pose');
        }
        if (clip.baseLock) {
          if (!checkedBaseLocks.has(key)) checkedBaseLocks.set(key,
            measureEnvironmentAnimationAtlasBaseLock(verifiedFiles.get(source.path), clip));
          const offsets = checkedBaseLocks.get(key);
          demand(offsets && offsets.every(({ x, y }, index) => x === clip.baseLock[index].x && y === clip.baseLock[index].y),
            'ANIMATION_BASE_LOCK', source.path, '/', 'Base lock offsets differ from the verified atlas');
        }
      }
    }
  });
  if (continuous) {
    const snow = kit.terrainAppearance.format === 'ai_scene_continuous_terrain_appearance_v3';
    const joined = kit.terrainAppearance.format === 'ai_scene_continuous_terrain_appearance_v4';
    const denseMeasured=kit.terrainAppearance.format==='ai_scene_continuous_terrain_appearance_v6';
    const measured=denseMeasured||kit.terrainAppearance.format==='ai_scene_continuous_terrain_appearance_v5';
    const samplingDensity=denseMeasured?2:1,normalizationHeight=denseMeasured?506:253;
    if (macro) demand(kit.terrainAppearance.profileSha256 === (denseMeasured?MEASURED_FIELD_DENSITY2_SHA256:measured?MEASURED_FIELD_SHA256:joined ? JOINED_FIELD_SHA256 : snow ? SNOW_SURFACE_SHA256 : 'eea16fad6eb3530f9a9586877bf9c9aace07137d5f893f75a6218eb09a4b51dd'),
      'APPEARANCE_PROFILE', 'kit.json', '/terrainAppearance', 'Material format must match its versioned derivation profile');
    const origin=kit.terrainAppearance.surfaceOriginInBodyPixels;
    demand(joined||measured?origin&&Number.isSafeInteger(origin.numerator)&&Number.isSafeInteger(origin.denominator)&&origin.denominator>0
      &&origin.numerator/origin.denominator>=-64*samplingDensity&&origin.numerator<=0
      &&(measured||origin.numerator>=-1048576&&origin.denominator<=1048576):origin===undefined,
      'APPEARANCE_ORIGIN','kit.json','/terrainAppearance','Only joined fields declare a bounded source-row origin');
    const {capDepth,capUvEnd,surfaceMappingSha256}=kit.terrainAppearance;
    const positive=value=>value&&Number.isSafeInteger(value.numerator)&&Number.isSafeInteger(value.denominator)&&value.numerator>0&&value.denominator>0;
    demand(measured?positive(capDepth)&&capDepth.numerator/capDepth.denominator<=128&&positive(capUvEnd)
      &&capUvEnd.numerator<=capUvEnd.denominator&&/^[a-f0-9]{64}$/.test(surfaceMappingSha256)
      &&kit.terrainAppearance.cap.pixelSize.height>=2*samplingDensity&&kit.terrainAppearance.cap.pixelSize.height<=64*samplingDensity
      &&(!denseMeasured||kit.terrainAppearance.cap.pixelSize.height%2===0)
      &&Math.abs(capDepth.numerator/capDepth.denominator-(samplingDensity-origin.numerator/origin.denominator)*256/normalizationHeight)<1e-9
      &&Math.abs(capUvEnd.numerator/capUvEnd.denominator-(samplingDensity-origin.numerator/origin.denominator)/kit.terrainAppearance.cap.pixelSize.height)<1e-9
      :capDepth===undefined&&capUvEnd===undefined&&surfaceMappingSha256===undefined,
    'APPEARANCE_MEASURED_MAPPING','kit.json','/terrainAppearance','Measured fields require a coherent source origin, coverage and UV endpoint');
    demand(kit.grid.width === 64 && kit.grid.height === 64 && density === 1,
      'APPEARANCE_GEOMETRY', 'kit.json', '/terrainAppearance', 'Continuous appearance requires the declared 64-unit identity geometry');
    for (const module of catalog.modules.filter(module => module.kind === 'terrain')) demand(
      module.pixelSize.width === 64 && module.pixelSize.height === 64 && module.anchorPx.x === 0 && module.anchorPx.y === 0,
      'APPEARANCE_GEOMETRY', refs.catalog.path, '/modules', 'Continuous phase tiles must have exact cell canvases and zero anchors');
    for (const [kind, height] of [['body', normalizationHeight], ['cap', measured?kit.terrainAppearance.cap.pixelSize.height:joined ? 32 : snow ? 16 : 8]]) {
      const item = kit.terrainAppearance[kind], source = item.source;
      demand(source.path.endsWith('.png') && !verifiedFiles.has(source.path), 'APPEARANCE_SOURCE', 'kit.json', `/terrainAppearance/${kind}`, 'Material fields must use distinct PNG sources');
      const bytes = readSafe(source.path, 16777216); sourceBytes += bytes.length;
      declaredPixels += item.pixelSize.width * item.pixelSize.height;
      demand(sourceBytes <= 134217728 && declaredPixels <= 67108864, 'RESOURCE_LIMIT', 'kit.json', '/terrainAppearance', 'Material fields exceed the bundle budget');
      demand(bytes.length === source.byteLength && sha256(bytes) === source.sha256,
        'CHECKSUM_MISMATCH', 'kit.json', `/terrainAppearance/${kind}`, 'Material field byte count or checksum differs');
      let image;
      try { image = inspectPng(bytes); } catch (error) { reject('PNG_INVALID', source.path, '/', error.message); }
      demand(image.width === (macro ? 505*samplingDensity : 253) && image.height === height && item.pixelSize.width === image.width && item.pixelSize.height === image.height
        && image.nonzeroAlphaPixels > 0, 'APPEARANCE_GEOMETRY', 'kit.json', `/terrainAppearance/${kind}`, 'Material field dimensions or content differ from the fixed profile');
      if(measured)demand(image.transparentPixels===0,'APPEARANCE_MEASURED_ALPHA','kit.json',`/terrainAppearance/${kind}`,'Measured source fields preserve opaque paint without an alpha fade');
    }
  }
  if(kit.terrainMaterialLoop){
    const denseEdges=kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
      &&kit.terrainAppearance?.format==='ai_scene_continuous_terrain_appearance_v6';
    const sharedField=kit.terrainSharedField&&supportsSharedTerrainAppearance(kit.terrainAppearance,kit.terrainSharedField);
    demand(kit.format==='ai_scene_kit_v4'&&(denseEdges||sharedField),'MATERIAL_LOOP_BINDING','kit.json','/terrainMaterialLoop','Loop material requires a supported checked union kit');
    const output=kit.terrainMaterialLoop.output;
    demand(!verifiedFiles.has(output.source.path),'MATERIAL_LOOP_OUTPUT_PATH','kit.json','/terrainMaterialLoop','The replayed loop requires a distinct new PNG');
    declaredPixels+=output.pixelSize.width*output.pixelSize.height;
    demand(declaredPixels<=67108864,'RESOURCE_LIMIT','kit.json','/terrainMaterialLoop','Loop pixels exceed the bundle budget');
    validateTerrainMaterialLoop(kit.terrainMaterialLoop,{appearance:kit.terrainAppearance,readAsset:name=>{
      const known=verifiedFiles.has(name),bytes=readSafe(name,16777216);if(!known)sourceBytes+=bytes.length;
      demand(sourceBytes<=134217728,'RESOURCE_LIMIT','kit.json','/terrainMaterialLoop','Loop sources exceed the bundle byte budget');
      return bytes;
    }});
  }
  if(kit.terrainRigidRepeat){
    demand(!kit.terrainMaterialLoop&&kit.format==='ai_scene_kit_v4'&&kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
      &&kit.terrainAppearance?.format==='ai_scene_continuous_terrain_appearance_v6','RIGID_REPEAT_BINDING','kit.json','/terrainRigidRepeat','Rigid repeat requires the checked dense union kit and its own source crop');
    const output=kit.terrainRigidRepeat.output;
    demand(!verifiedFiles.has(output.source.path),'RIGID_REPEAT_OUTPUT_PATH','kit.json','/terrainRigidRepeat','Rigid repeat uses a distinct PNG');
    declaredPixels+=output.pixelSize.width*output.pixelSize.height;
    demand(declaredPixels<=67108864,'RESOURCE_LIMIT','kit.json','/terrainRigidRepeat','Rigid repeat pixels exceed the bundle budget');
    validateTerrainRigidRepeat(kit.terrainRigidRepeat,{appearance:kit.terrainAppearance,readAsset:name=>{
      const known=verifiedFiles.has(name),bytes=readSafe(name,16777216);if(!known)sourceBytes+=bytes.length;
      demand(sourceBytes<=134217728,'RESOURCE_LIMIT','kit.json','/terrainRigidRepeat','Rigid repeat sources exceed the bundle byte budget');return bytes;
    }});
  }
  if(kit.terrainSurfaceCycle){
    const cycle=kit.terrainSurfaceCycle,source=kit.terrainAppearance?.cap?.source;
    demand(kit.format==='ai_scene_kit_v4'&&kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
      &&kit.terrainEdges.surfaceInterface&&kit.terrainAppearance?.format==='ai_scene_continuous_terrain_appearance_v6'
      &&source.path===cycle.sourceInput.path&&source.sha256===cycle.sourceInput.sha256&&source.byteLength===cycle.sourceInput.byteLength,
      'SURFACE_CYCLE_BINDING','kit.json','/terrainSurfaceCycle','Cap cycles require the checked dense union source and an explicit native-row interface');
    demand(!verifiedFiles.has(cycle.output.source.path),'SURFACE_CYCLE_OUTPUT','kit.json','/terrainSurfaceCycle','The original cap remains distinct from its derived cycle');
    declaredPixels+=cycle.output.pixelSize.width*cycle.output.pixelSize.height;
    demand(declaredPixels<=67108864,'RESOURCE_LIMIT','kit.json','/terrainSurfaceCycle','Cap cycle pixels exceed the bundle budget');
    validateTerrainSurfaceCycle(cycle,{readAsset:name=>{
      const known=verifiedFiles.has(name),bytes=readSafe(name,16777216);if(!known)sourceBytes+=bytes.length;
      demand(sourceBytes<=134217728,'RESOURCE_LIMIT','kit.json','/terrainSurfaceCycle','Cap cycle sources exceed the bundle byte budget');return bytes;
    }});
  }
  if(kit.terrainSurfaceSpanEnvelope){
    demand(kit.format==='ai_scene_kit_v4'&&kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
      &&kit.terrainAppearance?.format==='ai_scene_continuous_terrain_appearance_v6'&&kit.terrainEdges.surfaceInterface,
      'TERRAIN_SURFACE_SPAN_BINDING','kit.json','/terrainSurfaceSpanEnvelope','Span coverage requires the checked dense union and explicit native lip interface');
    validateTerrainSurfaceSpanProfile(kit.terrainSurfaceSpanEnvelope,{
      appearance:resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop,kit.terrainRigidRepeat,kit.terrainSurfaceCycle),
      surfaceInterface:resolveTerrainSurfaceInterface(kit.terrainEdges.surfaceInterface,kit.terrainSurfaceCycle)});
  }
  if(kit.terrainStepCorners){
    demand(kit.format==='ai_scene_kit_v4'&&kit.terrainEdges?.format==='ai_scene_terrain_edges_v6',
      'STEP_CORNER_BINDING','kit.json','/terrainStepCorners','Step junctions require an explicit union-capable kit');
    validateTerrainStepCorners(kit.terrainStepCorners);
  }
  if(kit.terrainStepSurface){
    demand(kit.format==='ai_scene_kit_v4'&&kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'&&kit.terrainStepCorners
      &&kit.terrainAppearance?.format==='ai_scene_continuous_terrain_appearance_v6'&&kit.terrainEdges.surfaceInterface,
      'STEP_SURFACE_BINDING','kit.json','/terrainStepSurface','Step surface coverage requires dense native-lip terrain and an explicit step profile');
    validateTerrainStepSurface(kit.terrainStepSurface,{
      appearance:resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop,kit.terrainRigidRepeat,kit.terrainSurfaceCycle),
      surfaceInterface:resolveTerrainSurfaceInterface(kit.terrainEdges.surfaceInterface,kit.terrainSurfaceCycle),
      surfaceSpanEnvelope:kit.terrainSurfaceSpanEnvelope,stepCorners:kit.terrainStepCorners});
  }
  if(kit.terrainSharedField){
    demand(kit.format==='ai_scene_kit_v4'&&!kit.terrainEdges&&!kit.terrainBottomEdges&&!kit.terrainStepCorners&&!kit.terrainRigidRepeat
      &&supportsSharedTerrainAppearance(kit.terrainAppearance,kit.terrainSharedField),'SHARED_FIELD_KIT_CONFLICT','kit.json','/terrainSharedField','Shared field presentation requires a supported measured appearance and owns the perimeter');
    validateSharedTerrainFieldProfile(kit.terrainSharedField,resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop));
  }
  if (kit.terrainEdges) {
    validateTerrainEdges(kit.terrainEdges, kit.terrainAppearance);
    declaredPixels += terrainEdgeSources(kit.terrainEdges).reduce((total, item) => total + item.pixelSize.width * item.pixelSize.height, 0);
    demand(declaredPixels <= 67108864, 'RESOURCE_LIMIT', 'kit.json', '/terrainEdges', 'Edge pixels exceed the bundle budget');
    validateTerrainEdges(kit.terrainEdges, kit.terrainAppearance, { readAsset: name => {
      const bytes = readSafe(name, 16777216); sourceBytes += bytes.length;
      demand(sourceBytes <= 134217728, 'RESOURCE_LIMIT', 'kit.json', '/terrainEdges', 'Edge source bytes exceed the bundle budget');
      return bytes;
    } });
  }
  if(kit.terrainBottomEdges){
    demand(kit.format==='ai_scene_kit_v4'&&kit.terrainEdges?.format==='ai_scene_terrain_edges_v6',
      'TERRAIN_BOTTOM_BINDING','kit.json','/terrainBottomEdges','Native bottom rims require a union-capable kit');
    validateTerrainBottomEdges(kit.terrainBottomEdges,kit.terrainAppearance,{terrainEdges:kit.terrainEdges});
    declaredPixels+=terrainBottomEdgeSources(kit.terrainBottomEdges).reduce((n,item)=>n+item.pixelSize.width*item.pixelSize.height,0);
    demand(declaredPixels<=67108864,'RESOURCE_LIMIT','kit.json','/terrainBottomEdges','Bottom sources exceed the pixel budget');
    validateTerrainBottomEdges(kit.terrainBottomEdges,kit.terrainAppearance,{terrainEdges:kit.terrainEdges,readAsset:name=>{
      const known=verifiedFiles.has(name),bytes=readSafe(name,16777216);if(!known)sourceBytes+=bytes.length;
      demand(sourceBytes<=134217728,'RESOURCE_LIMIT','kit.json','/terrainBottomEdges','Bottom sources exceed the byte budget');return bytes;
    }});
  }
  demand(rules.profile === PROFILE, 'PROFILE_UNSUPPORTED', refs.rules.path, '/profile', 'Only the side-view solid profile is implemented');
  const seenSignatures = new Set(), usedTerrain = new Set();
  rules.entries.forEach((entry, index) => {
    const at = `/entries/${index}`;
    demand(SIGNATURES.includes(entry.signature), 'SIGNATURE_NONCANONICAL', refs.rules.path, `${at}/signature`, 'Signature is not a canonical eight-neighbor pattern');
    demand(!seenSignatures.has(entry.signature), 'SIGNATURE_DUPLICATE', refs.rules.path, `${at}/signature`, 'Each signature must have exactly one mapping');
    if (continuous) demand(entry.variantAssetIds.length === (macro ? 32 : 16), 'APPEARANCE_PHASES', refs.rules.path, at, 'Continuous roles require the versioned phase count in order');
    seenSignatures.add(entry.signature);
    entry.variantAssetIds.forEach((assetId, variantIndex) => {
      demand(modules.get(assetId)?.kind === 'terrain', 'TERRAIN_ASSET_REFERENCE', refs.rules.path, `${at}/variantAssetIds/${variantIndex}`, 'Variant must reference a declared terrain module');
      demand(!usedTerrain.has(assetId), 'TERRAIN_ROLE_REUSED', refs.rules.path, `${at}/variantAssetIds/${variantIndex}`, 'A terrain asset cannot represent several topology roles');
      usedTerrain.add(assetId);
    });
  });
  demand(seenSignatures.size === SIGNATURES.length, 'TERRAIN_COVERAGE', refs.rules.path, '/entries', 'All 47 topology roles must be mapped');
  for (const module of modules.values()) {
    demand(module.kind !== 'terrain' || usedTerrain.has(module.assetId), 'TERRAIN_ASSET_UNUSED', refs.catalog.path, '/modules', 'Every terrain module must have an explicit topology role');
  }

  const model = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: refs.presets.path } });
  const summaries = [], mapIds = new Set(), maps = {};
  for (const role of ['default', 'inspection']) {
    const file = refs.maps[role];
    const map = load(file.path, continuous ? ['ai_scene_document_v1', 'ai_scene_document_v2', 'ai_scene_document_v3', 'ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'] : ['ai_scene_document_v1','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'], file.sha256);
    demand(!mapIds.has(map.mapId), 'DUPLICATE_ID', file.path, '/mapId', 'Default and inspection maps require distinct IDs');
    mapIds.add(map.mapId);
    maps[role] = map;
    summaries.push(model.analyzeMap(map, { artifact: file.path, role, allowEmpty: false }).summary);
  }
  const report = {
    ok: true, status: 'contract-valid', kitId: kit.kitId, revision: kit.revision, purpose: kit.purpose,
    moduleCount: modules.size, terrainRoleCount: seenSignatures.size, presetCount: library.presets.length,
    maps: summaries, visualAcceptance: 'not-assessed', generationCalls: 0,
    scope: ['bundled-schemas', 'references', 'sha256', 'bounded-png-integrity', 'terrain-coverage', 'map-semantics'],
  };
  return snapshot ? { report, kit, catalog, rules, library, maps, model, files: verifiedFiles, sourceRoot: root } : report;
}

export function loadBundleSnapshot(root) {
  try { return inspectBundle(directoryBundleReader(root), true); }
  catch (error) {
    if (error instanceof InvalidKit) throw error;
    reject('VALIDATION_INTERNAL', 'kit.json', '/', 'Unexpected validation failure');
  }
}

// Local revisions already own their source bytes. Replay the same checks and
// derive the same file closure without copying the kit through a temp folder.
export function loadBundleRevisionSnapshot(root, files) {
  return inspectBundle({ root, read: name => files.get(name) }, true);
}

export function validateBundle(root) {
  try { return inspectBundle(directoryBundleReader(root)); }
  catch (error) {
    if (error instanceof InvalidKit) return { ok: false, status: 'contract-invalid', errors: error.errors, generationCalls: 0 };
    // Never print a private host path or filesystem exception from public validation.
    return { ok: false, status: 'contract-invalid', errors: [{ code: 'VALIDATION_INTERNAL', artifact: 'kit.json', path: '/', message: 'Unexpected validation failure' }], generationCalls: 0 };
  }
}
