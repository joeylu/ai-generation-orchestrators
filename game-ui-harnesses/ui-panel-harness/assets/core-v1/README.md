# Core icons 1.0.0

This is the exact owned core library selected by `src/core-asset-profile.mjs`.
The 12 SVG sources, normalized PNGs, previews and semantic index retain their verified bytes.
`delivery.json` is the original deterministic asset importer output, not a new hand-authored manifest.

- Library: `panel-core-assets`
- Library SHA-256: `3eab8e6982d15ee4d4ea65e11573863376458b366a20bce17c5dc10a91adcefd`
- Delivery file SHA-256: `58318f52efdd5fb913177cfa19c47ec92a5dbc3bbc3e8cc66810e81c493fab2f`
- Workbench pool SHA-256: `adec5027d1ffbd0b89621674600749e67e0eb4c32b28c47dee5387703f2a7e3c`

Source replay uses Sharp 0.35.4 / vips 8.18.6, as recorded in the index.
Default Studio startup checks the pinned manifest and every listed file, then validates the complete pool.
It needs no image adapter and does not repeat source rendering or alpha analysis at startup.
The original semantic/visual/native verification flags remain unchanged; subsequent local browser and real-model
evidence is described in [core assets](../../docs/core-assets.md), separately from the importer evidence.

Do not overwrite versioned keys or regenerate this manifest in place.
Extend into a fresh library with the standard asset importer and `--base assets/core-v1`.
