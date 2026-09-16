# Foreground gap extraction 1.0

Producer-only opt-in policy for a single horizontal row of keyed assets:

```json
{"version":"1.0","mode":"foreground-gap-row","target_padding":2,"max_canvas_aspect_error":0.15}
```

Use this as `extraction_policy` in component-family board observations. Keep
the asset order and target sizes explicit. Nominal windows guide generation;
they are not pixel-exact cutting requirements in this mode. Existing fixed
pixel and `relative-cell` policies remain unchanged.

The deterministic extractor uses the existing declared magenta key and foreground
threshold, projects foreground onto columns, requires exactly one occupied run
per asset, and places boundaries inside intervening empty columns. It rejects
canvas-edge contact, fewer/more runs, gaps narrower than two pixels, multiple
vertical runs inside a partition, and rows without a shared vertical overlap.
It never discards small foreground regions as noise to force the expected count.
Disconnected details with empty internal columns may be rejected conservatively.
This mode does not segment arbitrary grids or infer semantic identity from geometry.
Left-to-right assignment follows declared slot order; semantic review remains required.

Each partition receives existing global key removal, Alpha-bound cropping and
uniform contain fitting with the declared transparent target padding. Receipts
record actual windows, matte bounds, scale, offsets, Alpha bounds and fingerprints.
State registration and runtime acceptance remain separate checks.

For an already generated image whose frozen policy failed, do not rewrite its
strategy, prompt, failed record or generation receipt. After an explicit user
decision to change deterministic extraction, use:

```text
python -m ai_ui_decomposition.board_extraction_revision --raw RAW.png --strategy ORIGINAL.json --board BOARD_ID --expected-sha256 SHA256 --policy POLICY.json --reason REASON --output NEW_DIRECTORY
```

The revision validates the original strategy and raw fingerprint and writes a
distinct material-only receipt. It does not authorize generation, validate a
provider receipt, or automatically enter an accepted delivery. Downstream joining
must explicitly support this revision lineage; it must not substitute the revision
for the original strategy's digest-bound extraction receipt.

`sourced_handoff.prepare_from_sources` supports an optional producer-side
`extractionRevision` on a completed source selection:

```json
{
  "version": "1.0",
  "originalStrategyDigest": "<original verified strategy digest>",
  "policy": {"version":"1.0","mode":"foreground-gap-row","target_padding":2,"max_canvas_aspect_error":0.15},
  "reason": "Explicitly approved deterministic extraction adjustment"
}
```

The source must retain a non-null `expectedRawSha256` and an authenticated
completed batch receipt. The join checks the original strategy marker in the
frozen generation prompt, then reruns extraction against that verified raw.
It never imports loose edited part PNGs or rewrites the generation strategy.
The new material lineage records both the original batch and revision digest.
The existing official handoff builder and full acceptance gates still apply.
This is a producer extension; no consumer schema change is required.
