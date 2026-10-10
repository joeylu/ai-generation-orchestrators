# Versioned section-heading presentation

The rc.2 policy introduced `modern-menu-headings` 0.19.0. Its eight default themes
have `headingStyle: concise-v1`, require `semantic-v1` / `minimal-v2`, and select
Panel compiler 0.27.0. Colors, controls, recipes and the twelve owned icons are
unchanged from `modern-menu`. There are eight otherwise matching 0.19.1 themes
with `headingStyle: visible-v1` for an explicit request to show section headings.

The current rc.3 default is catalog 0.20.0, with concise-v2 / visible-v2 and
compiler 0.28.0. It retains the visibility rules below and fixes the section
recipe floor after title collapse. See [section geometry and compatibility](section-geometry.md).

| Structure | concise-v1 behavior |
| --- | --- |
| One section, one control | Omit the section title node and its title band |
| One section, multiple controls | Omit an exact duplicate of the panel heading; keep a distinct heading |
| Multiple sections | Keep headings, including music/effects groups with identical volume labels |
| Tabs | Keep section headings and page labels |
| Explicit visible-v1 | Keep every section heading, including an otherwise redundant one |

The exact comparison trims whitespace and removes only the terminal type suffix
`界面` or `面板`, as in the previous presentation. It is not substring matching or
model-based inference. A single multi-control group with a distinct title is kept
conservatively; arbitrary per-section hiding is not supported.

`section.title` stays required and nonempty. No semantic text, row label, value,
stable ID, event, binding or asset is removed. The existing presentation policy
owns both visibility and measurement; the compiler omits the title node. For the
single Slider fixture, the first row moves from y=44 to y=0 and section height
decreases by 44px. Web/Pixi and UGUI consume the same compiled document.

## Existing bundles and explicit adoption

The original catalog and theme versions retain their meanings. Loading an old
bundle, restoring state, exporting it, or editing unrelated wording does not
adopt 0.27.0. An actual rc.1-generated golden bundle is checked in under
`tests/fixtures/section-headings/rc1-single.bundle.json`; its complete envelope
and digest recompile identically. Changing only its compilerVersion is rejected.

The workbench model offers an explicit, deterministic adoption operation:

```js
const sdk = await loadPanelSdk();
const model = await sdk.createWorkbenchModel(sdk.seed, sdk.core);
await model.importPanel(savedBundle);
// Invoke only after the user requests this presentation change.
await model.adoptSectionHeadings('auto', currentPlayState);
// 'show' selects the otherwise matching visible policy instead.
const updated = await model.exportPanel();
model.dispose();
```

Adoption requires the model's seed catalog to contain an otherwise identical
theme and unchanged source recipes. A custom or unmatched catalog fails with
`HEADING_UPGRADE_UNAVAILABLE`, without a partial update. It preserves embedded
asset bytes even when no asset library is supplied, preserves legal play state,
and appends a theme patch receipt and catalog/compiler transition to existing
history. Undo restores the prior bundle. One successful change consumes one of
the original ten successful edits; undo, import and usage restoration cannot
refund it. Repeating an already adopted policy changes nothing and consumes no
additional edit. A failed presentation commits nothing and consumes no edit.

For a panel already on the new catalog, an ordinary `set-theme` patch can select
the same color/mode with the other heading policy. Generation/edit guidance
advertises this exact choice. Unrelated edits preserve the current theme. No
Studio migration button or automatic bulk migration is introduced.

## Verification and release

`tests/section-headings.test.mjs` covers the title rules, layout, old bundle
replay, JSON import/export, state 57, shared UGUI nodes, embedded icon bytes,
history, rollback and the ten-edit budget. `scripts/check-release.mjs` repeats
the contract using the installed SDK outside the checkout, creates actual ZIPs
and checks their contents and hashes. `scripts/check-heading-browser.mjs` opens
those extracted offline previews, checks runtime nodes, light/dark mode,
390px scaling, a real keyboard Slider interaction, restoration and cleanup.

The current SDK release is `ui-panel-harness-v0.1.0-rc.3`; install its full archive
only after checking the published bytes and SHA-256. Never replace the rc.1 or rc.2 tag
or archive. The release receipt binds the source, archive and reports.
Existing real-model receipts remain bound to their original SDK and cannot be
relabeled for this release. This work uses fixtures only: real model calls 0,
Unity native import `NOT_RUN`. Consumer service deployment and any newly
authorized real-model acceptance remain separate work.
