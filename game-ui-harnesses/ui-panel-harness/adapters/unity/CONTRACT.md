# Unity UGUI adapter contract 0.1.4

Implementation target: Unity 6 / UGUI 2.0. This adapter consumes a verified
PanelBundle 0.1–0.14 and exports a local import kit. The kit does not itself count
as a Unity-validated Prefab. Unity creates the native Prefab with its own API.

`panel.unity.json` contains a flat, parent-before-child `PanelDocument`:

- `formatVersion`: `"0.1"`; current `adapterVersion`: `"0.1.4"`.
- `panelId`, `panelSha256`, `panelSpecVersion`: source identity.
- `canvasWidth`, `canvasHeight`: positive logical pixels.
- `nodes`: `PanelNode[]` below, including the source canvas root.
- `fields`: `PanelField[]` below; may be empty.
- `controls`: `PanelControl[]` below; may be empty.
- `assets`: `PanelAsset[]`: `path`, `sha256`, `bytes`, `width`, `height`.

`PanelNode` fields (optional values are noted):

```text
string id, parentId, type
float x, y, width, height
string backgroundColor, borderColor, textColor
float borderWidth, cornerRadius, opacity
int fontSize
bool bold, drawBackground
string text, source, fit
string textAlignment                # optional; explicit anchor for the panel title
bool hasRegion
float regionX, regionY, regionWidth, regionHeight
float contentWidth, contentHeight
```

The root has `parentId:""`; all other parents precede their children. Types are
Container, Text, Image, Slider, Switch, Select, Button, ProgressBar, ScrollView,
Tabs and Input. Coordinates
are top-left, y-down, relative to the declared parent. ScrollView children attach
under its Content transform; the declared viewport remains at the node ID.
Image source paths are `textures/<sha256>.png`. Regions use top-left PNG pixels;
Unity Sprite rect y is `imageHeight - regionY - regionHeight`. Icons retain
contain aspect, while individual nine-slice regions stretch. White image tint
preserves PNG colors; optional badge is a separate background.

`PanelField` fields (unused values are zero/false/empty):

```text
string id, type                       # number | boolean | enum | progress | string
double min, max, step, initialNumber, numberValue
bool initialBoolean, booleanValue
string initialString, stringValue
PanelOption[] options                 # { string id, label }
int maxLength                         # string fields only; omitted otherwise
```

`PanelControl` fields (kind-specific values may be omitted in JSON):

```text
string nodeId, rowId, kind, fieldId, eventName
bool enabled
string action                        # empty | emit | reset-initial | submit
string[] resetFields
string valueTextId, prefix, suffix
int fractionDigits
string displayMode                   # progress only
string[] contentIds                  # tabs only
string[] submitFields                # submit action only
string placeholder, inputType, requiredErrorTextId, minLengthErrorTextId
bool readOnly                        # input only
PanelInputValidation validation      # input: required, minLength, messages
```

Controls include interactive rows, host-driven progress rows, and an optional
Tabs control. Text rows have no control record. Input uses native InputField;
submit validates the selected string fields before emitting their values.
Progress uses a native fill with host-driven state updates. Tabs activate only
their declared content roots. Slider uses integer step indices in
native UGUI, preserving the double business value in the controller. A native
float cannot encode every possible source value, so the exporter rejects more
than 1,000,000 slider intervals. Every exported tick must round-trip under the
source step tolerance; ranges which lose representable precision at an offset
are rejected as well. Snapshot assignment validates the complete input before
applying any control. Programmatic state changes do not emit host events.
Reset restores only declared fields to source initial values; exported current
values remain distinct from those initial values. Disabled user controls cannot
change state or activate actions. Emit buttons only notify the host.

Runtime namespace: `GameUi.PanelHarness`.

- `PanelController.Configure(PanelDocument document, PanelControlView[] views)`
  stores a serializable deep snapshot and references, then binds listeners.
- `PanelControlView`: public `PanelControl definition`, `Slider slider`,
  `Toggle toggle`, `Dropdown dropdown`, `Button button`, `Text valueText`,
  plus native InputField, progress and Tabs references for those control kinds.
- `PanelController.GetStateJson()` returns the original business object shape.
- `PanelController.SetNumber/SetBoolean/SetChoice(fieldId,value)` validate and
  change a field silently. `PanelController.Activate(rowId)` applies enabled
  button semantics and emits. `PanelController.EventRaised` is a C# event with
  a `PanelHostEvent` carrying name, rowId, fieldId, action, typed value and state.
- Native OnEnable/OnDisable bind/unbind only owned listeners. Re-enabling and
  saving/loading a Prefab must preserve configured behavior without duplicates.
- `PanelRoundedGraphic` is a runtime UGUI Graphic used for procedural rounded
  backgrounds/borders; there is no texture-generation service.

Editor namespace: `GameUi.PanelHarness.Editor`.

- `PanelPrefabBuilder.Build(string documentPath, string outputAssetFolder, Font font)`
  validates the bounded import data and all PNG hashes before mutation, requires
  a persistent .ttf/.otf font supplied by the host (at most 64 MiB), copies its
  bytes and importer settings into the new panel's Fonts folder under a SHA-256
  name, writes only into a new folder below Assets, builds a
  Canvas/CanvasScaler/GraphicRaycaster and native components,
  calls PrefabUtility.SaveAsPrefabAsset, and returns the prefab asset path.
- Node identity remains the GameObject name; helper children have prefixed names.
- Build requires a folder matching the source panel ID under the adapter's Panels
  folder and a sibling unity-runtime.json matching the exact installed runtime.
  The generated panel-identity.json stores source/base digests, revision,
  adapter version/runtime fingerprint and native Prefab GUID/byte digest.
- `PanelPrefabBuilder.Update(string documentPath, string prefabAssetPath, Font font, string expectedPanelSha256)`
  requires the exact previous source digest, same ID and runtime, and an unmodified
  managed Prefab. It preserves the asset GUID and every surviving named GameObject/
  component local identifier. Helpers have globally unique parent-prefixed names.
  Failed saves/identifier checks restore the old Prefab, meta and identity record;
  newly imported immutable resources may remain for diagnosis. Removed objects
  cannot retain references. Update never rewrites a host scene.
- Unchanged per-panel fonts/PNGs/Sprites are reused. Sprite identity hashes image
  and region, independent of iteration order. Cross-panel resources are not deduplicated.
- No EventSystem is inserted into an existing scene. The host owns its EventSystem
  and input module. A test scene may create its own legacy module explicitly.
- No MenuItem, global project changes, network calls or automatic package installs.
- `PanelPrefabBuilder.ExportPackage(string prefabAssetPath, string packagePath)`
  packages the Prefab and required adapter dependencies; refuses an existing file.
  The Prefab must be below the adapter root's Panels folder. All Assets dependencies
  must share that root; an outside dependency is rejected before writing a package.
  Standard layout: Assets/PanelHarness/Runtime (shared) and
  Assets/PanelHarness/Panels/<panelId>/{Prefab,Fonts,Textures,Sprites}.
  The deterministic publisher inspects the native gzip/TAR pathname records,
  including bounds and checksums, and rejects additional roots or panel folders.
- The publisher verifies package identity, packaged Prefab digest and runtime bytes.
  `check-unity-install.mjs` is read-only and rejects GUID/runtime/base/local-change
  conflicts before a user imports a package. Unity's ordinary Import Package UI
  does not automatically run this check. Legacy 0.1.0 trials lack update identity;
  0.1.1 runtime still accepts their document shape without inventing an update base.

This document describes the current adapter; old bundles retain their original
protocol versions and capability fields. Native
appearance uses UGUI rasterization and host font metrics; pixel identity with
Pixi, live browser resize layout, and native exports for other engines are not
part of this adapter version.

Optional shared game binding lives in GameRuntime, with reference ports in GameExamples.
It reuses the installed Runtime and HostRuntime; generated panel packages do not include it.
Bindings pin panel identity, route explicit field/row IDs, silently synchronize complete state,
and cancel owned commands when disposed. The game owns its business port, persistence,
audio sources and main-thread scheduling. See docs/unity-game-binding.md for the native
payload lowering, installation and isolated Play Mode acceptance scope.
