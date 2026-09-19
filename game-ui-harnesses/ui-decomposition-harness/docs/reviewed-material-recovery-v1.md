# Reviewed material recovery 1.0

An explicit offline producer for a fully received run whose original batch quality
report may have failed. It never authorizes, reserves, submits or retries media.
Normal `verified_result`, cached reuse and original workflow processing still reject
failed quality. All original files and quality statuses remain unchanged.

Run `python -m ai_ui_decomposition.reviewed_recovery --compiled DIR --run RUN
--specification FILE --output FRESH --component-root CONSUMER`.
The specification has exactly `version:"1.0"`, `batchDigest`, and `revisions`,
keyed by generated asset ID. Every revision requires `kind`, `rawSha256`, and a
nonempty reviewed `reason`. Original generation prompts, output dimensions,
reference identity, reservations, receipts and quality digests are revalidated.
Unknown assets/errors, pending quality and changed bytes fail closed.

- `board-regions` requires `sourceRegions` for every frozen slot. It uses the
  existing explicit region contract, with optional `measuredFrames`. Only named
  separation/count/aspect failures can be reconsidered; every foreground pixel
  and clear boundary is rechecked. No old threshold is changed.
- For native transparent boards, additionally declare `sourceAlpha:"preserve"`.
  This invokes source-region revision 1.1 and preserves actual Alpha and legitimate
  magenta foreground. It can reconsider a key-background mismatch only after
  this independent Alpha contract passes. Default key-board extraction is unchanged.
  Alpha-preserving extraction records `alphaSupportDiagnostic`: the source support
  at Alpha >= 8 compared with all nonzero Alpha. This is diagnostic only, with no
  threshold applied to the output. Distant faint pixels can shrink the visible
  icon; the reviewer must not interpret materialization success as visual approval.
- `native-alpha-canvas` requires exact `sourceAlphaExtrema`. Only RGBA with zero
  and nonzero Alpha is accepted, including genuinely partial maximum opacity.
  Preserve the complete returned canvas with uniform downsampling, without key
  removal, support crop, Alpha thresholding or normalization to opaque. Existing
  edge defects remain; this cannot reconstruct missing art. Only a declared-key
  background mismatch can be reconsidered. Output/consumer gates remain mandatory.
- `processed-frame-refit` requires `recipe` using only the existing
  `visible-frame-nine-slice` contract. It fingerprints the normally processed
  intermediate and preserves measured corner/end bands. The unchanged long-control
  geometry gate runs on the result. Never use it to stretch pictograms or hide a
  missing state. Record texture/divider resampling as a visual difference.
- `processed-ornament-refit` requires a hash-bound `recipe` using only
  `visible-horizontal-band-fit` from the processed-material contract. It may
  reconsider only `LONG_CONTROL_SUPPORT_ASPECT_MISMATCH`. Reproduce the original
  normal matte first and match its PNG digest and Alpha bounds; copy the inspected
  center ornament and both end bands exactly, adjusting only declared straight
  line bands. Preserve the full source tiling and source height. Run the same
  long-control geometry gate after fitting. This neither changes its threshold
  nor permits generic glyph distortion, missing-art repair or replacement pixels.
  The failed quality report remains failed, with its digest in recovery lineage.

The producer writes `recovery-lineage.json`, containing original raw/receipt/quality
hashes and statuses, revision specifications, extracted receipts and final material
hashes. It invokes the normal materialized handoff builder. `prepare_preview` accepts
an explicit `recovery` specification and binds this lineage into its preview receipt;
the same import/layout/default-browser gates apply. A preview is not acceptance.

The normal materializer expands only explicitly identical `Tabs` icon/active-icon
references for the same tab into unique consumer layer IDs. Byte-identical source
reuse is recorded in `binding-aliases.json`; there is no new generated state artwork.
Other duplicate role/owner combinations are rejected.

Native compilation now requires complete owner inventories for layout requirements
and observed text before generation. Batch preflight also checks the existing long
control geometry gate for individually generated rails, preventing later surprise
failures. These checks do not recognize arbitrary image semantics.
