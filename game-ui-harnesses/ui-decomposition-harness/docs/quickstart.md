# Local quickstart

Use Python 3.10 or 3.14. Run these commands from the Harness directory after
cloning the repository:

```text
python -m venv .venv
.venv/bin/python -m pip install ".[psd]"
.venv/bin/ai-ui-decomposition doctor
.venv/bin/ai-ui-decomposition self-test
```

On Windows, replace `.venv/bin/` with `.venv\Scripts\`.

Create a portable starter plan. `init` copies and EXIF-orients the reference into
the plan directory; it never changes the original.

```text
ai-ui-decomposition init --reference reference.png --plan project/plan.json --id inventory-r001 --document inventory-ui
```

Edit `project/plan.json` using the [plan contract](../references/contract.md).
Add only important component assets and groups. Keep ordinary text out of every
generated prompt and reviewed material.

```text
ai-ui-decomposition check --plan project/plan.json
ai-ui-decomposition freeze --plan project/plan.json --workspace workspace --run inventory-r001
ai-ui-decomposition status --run-dir workspace/runs/inventory-r001
```

For each prepared generated asset, export one portable request bundle:

```text
ai-ui-decomposition adapter-export --run-dir workspace/runs/inventory-r001 --asset scene --bundle outbox/scene-r001
```

Give that bundle to a provider adapter. It consumes `prompt.txt`,
`input/reference.png`, and `input/crop.png` and returns one image. Seal and import
the returned image without adding provider credentials to the run:

```text
ai-ui-decomposition adapter-seal --bundle outbox/scene-r001 --source provider-output.png
ai-ui-decomposition adapter-import --run-dir workspace/runs/inventory-r001 --bundle outbox/scene-r001
```

If a provider may have accepted the request but no reliable result is available,
run `indeterminate` for that asset and start a new run only after a new user
decision. Never reuse the request bundle.

After every generated asset is received:

```text
ai-ui-decomposition process --run-dir workspace/runs/inventory-r001
ai-ui-decomposition review-template --run-dir workspace/runs/inventory-r001
```

Inspect `materials/contact-sheet.png` and every material. After the user accepts
that exact contact sheet, set `decision` to `accept` in `review.json` and list all
asset IDs in `reviewed_asset_ids` without changing its digest fields.

```text
ai-ui-decomposition finalize --run-dir workspace/runs/inventory-r001 --output delivery/inventory-r001
ai-ui-decomposition export --delivery delivery/inventory-r001
ai-ui-decomposition inspect --delivery delivery/inventory-r001
```

The final report distinguishes PSD file roundtrip from an actual Photoshop
application-open check.

For the development image-only unattended entry, see [headless integration](headless.md).
It exports explicitly unreviewed draft PSDs through an optional configured provider;
the reviewed flow above remains available and unchanged by default.
