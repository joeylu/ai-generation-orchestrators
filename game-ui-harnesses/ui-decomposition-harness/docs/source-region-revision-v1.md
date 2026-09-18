# Explicit source-region revision

`board_extraction_revision.revise` optionally accepts `source_regions`, mapping
every original slot ID to integer raw-image `[x,y,width,height]` coordinates.
The CLI flag is `--source-regions`. Regions are explicit reviewed measurements,
not semantic detection or a change to the frozen generation request.

Regions must cover every original slot, remain inside the canvas, not overlap,
have clear key/transparent borders and retain all detected foreground. Empty
regions fail. Existing matte, target dimensions, frame fitting and alpha checks
remain in force. The receipt contains sourceRegions and the complete verified
sourceStrategy, bound to original strategy and raw image digests.

Revised receive reproduces the extraction before recording the specification.
Sourced handoff may explicitly select a subset under a new compiled contract;
each target layer ID and target size must match the original source slot. It
re-extracts all original parts, retains provenance and supplies only the target
subset. Discarded parts are not silently removed from historical evidence.
No generation retry, reference modification or visual acceptance is implied.

For framed rows with an end-state mark, use measured row-frame 1.1 to preserve
the full-height end bands after proportional height fitting. Never describe a
row with a checkmark as an empty frame. Shape and placement still need runtime
review. Old revisions without explicit regions retain their existing behavior.

## Source alpha preservation 1.1

For a returned board with genuine RGBA transparency, an explicitly reviewed
source-region revision may add:

```json
{
  "version": "1.1",
  "sourceAlpha": "preserve"
}
```

Pass it through the CLI as `--source-alpha preserve`. `sourceAlpha: "preserve"`
is valid only together with `sourceRegions`. The
verified raw image must have decoded alpha extrema `[0, 255]`; every source
region edge must be fully transparent; and every pixel with alpha greater than
zero must belong to one declared region. RGB values, including magenta, remain
foreground data in this mode. The extractor normalizes the explicit crop and
then applies the existing uniform fit or frame fit; it does not run key-color
matting. The revision receipt records `sourceAlpha` and remains bound to the
same raw SHA-256 and verified source strategy.

The default remains the 1.0 source-region path: it uses the existing key-color
contract and emits the 1.0 receipt shape. This extension does not authorize a
generation retry, alter a frozen plan or relax runtime acceptance.
