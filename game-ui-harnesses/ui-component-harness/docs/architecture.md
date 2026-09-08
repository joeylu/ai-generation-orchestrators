# Integration contract (development)

This document fixes module boundaries for implementation. Capability claims are
tracked by executed checks in tasks.md and reports, not by this design document.

## v0.2 core

`src/tree-contract.ts` exports `UiDocument`, `UiNode`, `ControlStyle`,
`validateDocument(unknown): UiDocument`, `walkNodes(document): UiNode[]`.
The document is `{schemaVersion:'0.2', id, canvas:{width,height}, root:UiNode}`.
Every node has `{id,type,layout:{x,y,width,height},props}`; only composite types
have `children:UiNode[]`. Coordinates are parent-relative; children draw in order.
Supported types: Image, Text, Container, Button, Switch, CheckBox, RadioGroup,
Input, Select, ProgressBar, Slider, ScrollView, List, Panel, Dialog, Tabs.

Exact type branches and field requirements are owned by the core module and
documented alongside it. No unknown fields or silent repair. All IDs globally
unique, bounded tree size/depth, finite layout and explicit styles. Only Image
may declare an optional source region; absence means full source by contract.
Image sources are relative portable paths or explicit HTTP(S), with no credentials.
Controls use explicitly supplied template colors/font settings. They are not
visual observations inferred from screenshots.

`src/tree-compiler.ts` exports `TreeIntent`, `TreePolicy`, `ImageFactsMap`,
`validateTreeIntent`, `validateTreePolicy`, `compileTree(intent,facts,policy)`.
Intent is `{intentVersion:'0.2',id,root}` with `componentType` instead of `type`
and no node layout. Policy is `{canvas,layout:{[nodeId]:Layout},layoutSource:{kind:
'explicit'|'measured',description}}`. Facts map source paths to actual decoded
`{width,height}`. Compiler checks resource facts and crop bounds and returns a
validated document. Unknown/Unresolved/Custom nodes do not become renderable.
Same inputs produce identical output; no mutation, DOM, PixiJS, file or network IO.
Legacy `contract.ts` and `intent-compiler.ts` remain available separately.

## browser runtime

`src/tree-runtime.ts` exports `createTreePreview(host,onFatal)` returning a Promise
of `TreePreview`. Implementations may add explicitly typed helpers as required.
Public API contains no PixiJS objects other than the acceptance canvas:

- `canvas:HTMLCanvasElement`
- `load(document, signal, resolver?)` resolves complete resources then mounts one
  tree atomically; resolver is `(source:string,signal:AbortSignal)=>Promise<HTMLImageElement>`.
- `subscribe(listener)` returns unsubscribe; events include `type`, `id`, optional
  `value`, `source`; include activate/change/focus/blur/destroy/scroll as applicable.
- `inspect()` returns `{instances,externalListeners,resources,nodes}`; each node
  exposes id/type, absolute bounds, visible/enabled and current value if relevant.
- `setValue(id,value)`, `setEnabled(id,boolean)`, `setVisible(id,boolean)` validate
  capability and values and report unsupported mutations.
- `setZoom(number)`, `destroy()` are explicit lifecycle operations.
- `getDocument()` returns a validated engine-neutral snapshot of current values.
- `applyMotion(id,{x?,y?,alpha?,scaleX?,scaleY?,rotation?})` and `resetMotion()`
  apply temporary visual transforms, separate from UI contracts.

Shared decoded sources/textures belong to the tree resource scope. Destroying
one node must not invalidate siblings; failures and cancellation clean all acquired
resources. Native input/IME may use a hidden editor, but visible controls use PixiJS.

## portable artifacts

`src/bundle.ts` owns verified JSON bundles with embedded bytes, MIME, SHA-256 and
portable source paths; browser temporary object URLs never enter stored contracts.
Support both v0.1 Button and v0.2 documents. All resources resolve within the
bundle or explicit local pack root; no implicit network fetch during CLI packaging.
Expose browser-compatible `createBundle(document, resources, provenance, motion?, motionSystem?)`
and `validateBundle(unknown)` as async operations, plus `bundleResources(bundle)`.
Resource input records are `{path,mime,bytes:Uint8Array}`. Provenance is explicit
`{kind:'programmatic-fixture'|'user-provided'|'vision-reviewed',description:string}`.
Browser resource helper may materialize verified bytes without persisting blob URLs.
Optional motion and interaction systems must be validated against the target
document before bundle acceptance. A system uses bundleVersion 0.2; bundles
without one remain 0.1 and retain legacy compatibility.

`scripts/cli.mjs` is a thin offline file wrapper for validate, inspect, compile,
pack, unpack, self-test and doctor. Only actually implemented commands are advertised.
Portable extraction never overwrites existing paths or follows links outside root.

## workbench and motion

Root integration owns `src/main.ts`, page/style, fixtures, `src/motion.ts`, and
browser acceptance tests. The workbench supports import files/intent/policy,
compile, tree inspector, errors, event log, bundle export/import, and separate
motion playback. A full procedural component gallery is an engineering fixture.
Motion targets validated IDs and has its own versioned document; no UI fields
are repurposed for timeline values. Real online vision remains unconfigured.

`src/motion-system.ts` owns three versioned style profiles, the 16-type action
registry, strict compilation/validation and the clock-injected shared scheduler.
It imports no renderer. Pixi owns generated control parts and input events in
`src/tree-runtime.ts`, with distinct logical/timeline and system presentation
layers. `scripts/motion-cli.mjs` and `skills/ui-motion/` expose both contracts.
