import { canonicalJson, digestBytes } from './canonical.mjs';
import { createUnityDocument, UNITY_ADAPTER_VERSION } from './unity-export.mjs';
import { validatePanelBundle } from './panel-bundle.mjs';

export const UNITY_SOURCE_PATHS = Object.freeze([
  'Runtime/PanelControlView.cs', 'Runtime/PanelController.cs', 'Runtime/PanelDocument.cs',
  'Runtime/PanelRoundedGraphic.cs', 'Runtime/PanelScrollReveal.cs', 'Editor/PanelPrefabBuilder.cs',
]);
const utf8 = value => new TextEncoder().encode(value);
const jsonBytes = value => utf8(`${canonicalJson(value)}\n`);

export async function createUnityRuntimeIdentity(sources) {
  const names = UNITY_SOURCE_PATHS.filter(name => name.startsWith('Runtime/')).sort();
  if (names.some(name => typeof sources?.[name] !== 'string' || !sources[name].length)) throw new Error('UNITY_ADAPTER_SOURCES');
  const entries = await Promise.all(names.map(async name => `${name.slice('Runtime/'.length)}:${await digestBytes(utf8(sources[name]))}\n`));
  return { adapterVersion: UNITY_ADAPTER_VERSION, runtimeSha256: await digestBytes(utf8(entries.join(''))) };
}
const readme = `# Unity UGUI import kit

This kit was created from a verified PanelBundle. It has not run Unity yet.

1. Copy Assets/PanelHarness into your project's Assets folder once. It requires
   Unity 6 and com.unity.ugui 2.0. No dependency installation runs automatically.
2. Create Assets/PanelHarness/Panels once, then use
   PanelPrefabBuilder.Build(documentPath, "Assets/PanelHarness/Panels/<panelId>", font)
   from GameUi.PanelHarness.Editor. Supply panel.unity.json and a persistent
   Font asset below Assets with all required characters. The output folder must not exist,
   and its parent must already exist. The supplied font is not bundled in this kit;
   Build copies its bytes and importer settings into the panel's Fonts folder.
3. Instantiate the returned Prefab in your own scene. The host must provide one
   EventSystem and an appropriate input module. Subscribe to PanelController's
   EventRaised to connect to your game. No game actions run automatically.
4. PanelPrefabBuilder.ExportPackage(prefabAssetPath, newPackagePath) can create
   a unitypackage after Unity has generated the Prefab. It requires the Prefab
   below the adapter's Panels folder and all asset dependencies under the same
   adapter root. Runtime is shared; each panel owns its Prefab, textures, sprites
   and copied font. Nothing is exported to Assets/Generated or another root.
5. For an existing managed panel, use
   PanelPrefabBuilder.Update(documentPath, prefabAssetPath, font, expectedPanelSha256).
   Pass the exact installed source digest from panel-identity.json. The panel ID
   stays stable; the revision increments. Surviving GameObjects/components retain
   GUID/local identifiers. Updates reject stale bases, different panel IDs, runtime
   version/fingerprint mismatches and locally modified Prefabs. Scene overrides
   are not copied back into the source panel. Removed controls cannot retain references.

unity-runtime.json binds this kit to the exact shared runtime source bytes.
Keep it beside panel.unity.json and textures. Generated panel-identity.json
records the native Prefab GUID/digest, source/base digests and revision. It is
produced by the Builder; do not edit it or rename managed assets outside Unity.
For multiple panels, use distinct stable English IDs (audio-settings, pause-menu)
and independent Chinese display titles. Never copy the shared Runtime into each
panel folder. Older 0.1.0 trial packages have no managed identity/update baseline.

Before a native package import, run scripts/check-unity-install.mjs with the
published delivery and target project. It is read-only. For an update it requires
--expected-panel-sha. It catches GUID, version, local-change and base conflicts.
Unity's ordinary Import Package dialog does not run this Harness check automatically.

Interactive controls are native UGUI Slider, Toggle, Dropdown, Button, InputField and
ScrollRect. Determinate progress uses native UGUI Image.Type.Filled (horizontal)
and is read-only. PanelController.SetProgress(fieldId, value) updates continuous
progress silently; no Slider, timer or game loader is added. PanelController bridges state/events; PanelRoundedGraphic draws
rounded surfaces; PanelScrollReveal reveals focused controls. Single-line inputs
preserve raw strings; SetText is silent. Required/minimum validation gates submit,
whose PanelHostEvent.Values contains only the declared input fields. PanelDocument
and PanelControlView are data types. This is native UGUI with adapter scripts.

The import preserves source IDs, declared coordinates, current values, initial
values, step-based sliders, switches, enumerated selects, buttons, reset scopes,
read-only text, validated single-line input, images and scrolling. Native fonts and UGUI rasterization can
differ from the Pixi preview. Layout is fixed to the declared logical canvas;
CanvasScaler scales that canvas, without recomputing grid columns.

Only generated UI data, selected PNGs and this small adapter are included.
No MUIP, private service, model, credentials or host paths are required.
Keep panel.unity.json and textures together. export-manifest.json fingerprints
the files; it is integrity evidence, not a signature or a Unity test report.
`;

/** Shared browser/CLI byte producer. The caller supplies only the six adapter sources. */
export async function createUnityKitFiles(input, core, sources) {
  if (!sources || Object.getPrototypeOf(sources) !== Object.prototype
    || Object.keys(sources).length !== UNITY_SOURCE_PATHS.length
    || UNITY_SOURCE_PATHS.some(path => typeof sources[path] !== 'string' || !sources[path].length))
    throw new Error('UNITY_ADAPTER_SOURCES');
  const bundle = await validatePanelBundle(input, core);
  const document = await createUnityDocument(bundle, core), contents = new Map();
  contents.set('panel.unity.json', jsonBytes(document));
  contents.set('unity-runtime.json', jsonBytes(await createUnityRuntimeIdentity(sources)));
  contents.set('panel.bundle.json', jsonBytes(bundle));
  contents.set('README.md', utf8(readme));
  const nativeAssets = new Set(document.assets.map(asset => asset.path));
  for (const resource of bundle.componentBundle.resources) {
    if (!nativeAssets.has(resource.path)) continue;
    const binary = atob(resource.base64);
    contents.set(resource.path, Uint8Array.from(binary, char => char.charCodeAt(0)));
  }
  for (const name of UNITY_SOURCE_PATHS) {
    const path = `Assets/PanelHarness/${name}`;
    contents.set(path, utf8(sources[name]));
    const guid = (await digestBytes(utf8(`ui-panel-harness/unity/0.1/${name}`))).slice(0, 32);
    contents.set(`${path}.meta`, utf8(`fileFormatVersion: 2\nguid: ${guid}\nMonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`));
  }
  const files = await Promise.all([...contents].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await digestBytes(bytes) })));
  const manifest = {
    unityExportVersion: '0.1', adapterVersion: UNITY_ADAPTER_VERSION, status: 'COMPLETE',
    panelSha256: document.panelSha256, target: 'unity-ugui', unityVersion: '6000.3', files,
    verification: { sourceBundle: 'PASS', unityImport: 'NOT_RUN', nativeInteraction: 'NOT_RUN', humanVisualReview: 'NOT_RUN' },
  };
  contents.set('export-manifest.json', jsonBytes(manifest));
  return { contents, manifest, panelId: bundle.spec.id };
}
