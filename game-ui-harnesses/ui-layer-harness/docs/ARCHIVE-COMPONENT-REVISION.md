# Atomic archive component revision

`archive_component_revision` is a separate deterministic candidate contract,
`atomic-observed-archive-components-v1`. It adds independent components or replaces
an entire existing parent with components. Existing revision APIs and strict gates
remain unchanged. It never calls a model, image tool, provider, network or CLI.

Each new source must pass `archive_component_exchange.verify_observation`, including
its genuine native return, single-use authorization/submission, honest host evidence
and original-reference observation chain. Parent storage, original reference and
inner/outer archive SHA must match the selected package. Parent bounds, ownership
and reference crops are provenance/context only; they never become child body boxes.
Ordinary archive sources and verified viewport wrapper sources are supported.

The selection JSON has exactly these fields:

```json
{
  "kind": "ui_archive_component_selection_v1",
  "sourceArchive": "local/source/viewport-ui-layers.zip",
  "sourceArchiveSha256": "<SHA-256>",
  "fitPolicy": {"maximumResidualPixels": 32},
  "operations": [{
    "mode": "replace-parent",
    "parentLayerId": "old-group",
    "parentSha256": "<SHA-256 of the authentic stored parent PNG>",
    "children": [{
      "componentId": "new-independent-icon",
      "observationDirectory": "local/sealed/icon-observation",
      "requestSha256": "<SHA-256 of observation request.json>",
      "responseSha256": "<SHA-256 of original answer/response.json>"
    }]
  }]
}
```

An optional `backgroundUpdates` array accepts entries with exactly `layerId`,
`jobDirectory` and `receiptSha256`. Each must replay
`archive_background_exchange.verify_received` against the same complete outer
archive, authentic stored background SHA, original-reference SHA and inner ZIP.
Its entire native job tree and receipt bytes are frozen. Only original-size,
fully opaque backgrounds at original coordinates `[0,0]` qualify. The verified
candidate copies actual native pixels within its explicit edit region and retains
source RGBA outside it; no body fitting or observer result is invented. Storage
position and dimensions stay identical before the common world shift. Background
records explicitly warn that canvas identity does not prove internal object
placement. A background update cannot conflict with a component parent operation.
An empty `operations` array is allowed for background-only revisions; at least
one component operation or background update is required.

`append-children` retains the original parent and inserts children immediately after
it, in the declared child array order. `replace-parent` removes that entire parent
exactly once and inserts the children at its former slot. Existing unrelated layer
order remains unchanged. Parent IDs must exist and be unique across operations;
component IDs must be globally unique and new. Duplicate, conflicting or unknown
identities and incorrect parent/source/reference hashes are rejected. The caller
cannot supply final layer coordinates or a replacement delivery manifest.

Every child of one operation must have usable actual geometry and a successful
uniform fit/render. If any required child is missing, unresolved or exceeds the
explicit residual ceiling, the entire operation retains the original parent and
adds no children. Other independent operations can still apply. Records preserve
every child finding and explicitly identify atomic failures. Material issues remain
material issues and do not change geometric usability or imply visual acceptance.
Corrupt, mismatched or forged evidence is rejected rather than silently treated
as an unresolved observation.

The explicit finite fit tolerance follows the existing candidate fit contract
([0,128] pixels). Actual complete body boxes or noncollinear visible landmarks
select one positive scalar and translation; no rotation or axis stretch occurs.
`viewport_geometry_revision.transform` preserves full nonzero storage support,
including alpha 1 and support outside the display viewport. Only zero-alpha
padding is removed. New rendered RGB is zero at alpha zero. Native receipts and
raw bytes remain unchanged; cubic resampling limitations remain explicitly reported.

Old world layer coordinates are converted back to authentic original-reference
coordinates by subtracting the verified old `worldShift`. New world bounds include
the full resulting layer storage plus the original viewport. A single new shift
makes coordinates nonnegative. Unchanged and retained parent PNG bytes and their
original-reference placement remain identical even if the new world shift differs.
Original reference bytes and original display dimensions remain unchanged.

`freeze(selection, fresh_output, actual_user_policy_instruction)` requires the real
nonempty user instruction authorizing this structural candidate and the already
approved `expanded-support-original-viewport-v1` storage/display policy. It does
not create compute authorization. It freezes selection, schema, exact proposal,
preview SHA, source archive, observation trees, native edit job trees and explicit
missing evidence paths. A missing child cannot silently appear after freezing;
newly complete inputs need a fresh freeze. It saves world and original-size viewport
previews for review, but no delivery ZIP.

`revise(frozen, expected_digest, fresh_output, viewer)` replays all bindings and
recomputes the specific approved proposal before exporting. Blank approval,
changed proposal, sources, native evidence or observations cannot produce an
authorized export. User instruction records are honest local host declarations,
without cryptographic proof of human authorship; private paths remain local.

The existing deterministic writer produces `delivery/ui-layers.zip` under its
unchanged standard contract. The existing viewport wrapper producer then creates
`delivery/viewport-ui-layers.zip`, carrying the world layer ZIP, viewport metadata,
exact original-size preview, byte-identical original reference and checksums.
Inner and outer SHA, CRC, full composition, viewport slice and reference identity
are verified. New revision provenance preserves source manifest/review, parent
deletion and child insertion relationships, actual observations and receipt bindings.
No historical logs, receipts or manifest files are modified.

All exported results remain pending human review. Strict body registration,
automatic DAG success, original DAG promotion and human acceptance remain false.
Structural success means the atomic deterministic operation was applied; it is
not an assertion that lettering, content ownership or visual appearance passed.

Offline fixtures cover add/replace order, atomic missing/unusable children,
wrong/colliding IDs and parent SHA, cross-wrapper observation reuse, real typed
native return chains, original coordinates and byte identity, faint alpha outside
viewport, exact reference identity and deterministic replay. No test generates media.

## Explicit complete-body diagnostic export

Optional selection `reviewMode: "complete-body-diagnostic-v1"` is a separate,
explicit request to place already sealed actual native components for final visual
comparison despite unresolved geometry issues. Omitted `reviewMode` preserves the
default atomic gate: unusable geometry still retains the entire parent operation.
No existing observation, `geo.assess` result, issue or strict gate is changed.

The user instruction passed to `freeze` must be the actual human authorization
for this diagnostic review, for example the user's intention to inspect the final
recomposition and then explain the remaining differences and make a human
acceptance decision. Do not invent approval text or reinterpret compute permission
as diagnostic authorization. The mode, instruction SHA and exact proposal are
frozen together and replayed by the new postprocessing runtime. Generating and
observing versions remain identifiable through their original sealed chains.

An unusable child can use this path only if its original answer is valid and
`boundaryStatus == "complete"`, with both genuine complete body boxes, a fully
verified actual native receipt and complete sealed observation evidence. The
frozen `maximumResidualPixels` must be at most **4**, and the normal positive
uniform fit must pass that ceiling. Full support rendering remains mandatory.
This does not force a larger residual, invalid transform or outside clipping
through. Uncertain/not-whole answers and unresolved landmark answers cannot use
this diagnostic override. A failed required child still retains the whole parent
operation without adding siblings.

A placed unresolved complete child records:

- `status: diagnostic-geometry-candidate`;
- `reason: complete-visible-body-diagnostic-with-unresolved-issues`;
- `diagnosticOnly: true` and `originalAssessmentUnchanged: true`;
- the original false `geometryUsableCandidate`, every `geometryIssues` entry and
  all material findings, together with actual fit residuals and source SHA.

Proposal, operation and result explicitly retain `reviewMode`, `diagnosticOnly:
true` and `qualitySuccess: false`; exported review issues state diagnostic use.
All human/strict/DAG flags remain false. An atomic operation being applied here
means a diagnostic composition was produced, never that the visual problem was
fixed or a quality gate passed. Final source/reference/viewport comparison and
the human decision remain outstanding.
