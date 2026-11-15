# Observed reference decomposition revision

An initial v4 coherent project can discover a missing source responsibility after
viewing its actual generated reference. Before reference acceptance or any source
batch, `reference-design-preview` accepts `{revisionId, requirements, sourceScopes}`
and exports a read-only proposal. The explicit design receipt for
`reference-design-adopt` binds the proposed **spec SHA**. This is a same-project,
same-journal revision, with zero image calls.

The original description, viewport, style, composition notes and seven standards
remain unchanged. Only decomposition changes. The original reference must be
technically passed and pending visual review; rejected, failed, unknown and
already accepted references are ineligible. This cannot remove a failed review or
replace a frozen source batch. Guided v6/v7 projects are unsupported.

Original descriptor files, plans, attempts, receipts and PNG bytes stay intact.
The new spec and its design decision are appended in the existing deterministic
workflow. The exact reference bytes use the existing zero-call candidate intake,
with explicit provenance binding to the original plan/raw SHA in
`observed-reference-design.json`. Candidate intake itself makes no generation
attestation; the original plan retains that evidence. Every read checks the
revision against the journal's candidate, design review and original raw identity.
No compute authorization transfers.

The revised candidate needs accurate analysis, `assess`, a separate reference
review with `--defer-source-plan true`, and observation coverage against its final
scopes before `advance`. New source compute needs a new exact batch decision and
single-use reservations. Final human art review remains separate.

This bounded version permits one revision, without automatic recovery after an
interrupted filesystem write. Inspect any partial adoption before further action;
never rerun generation as recovery. It provides no source recognition or art gate
relaxation.

```text
node scripts/coherent.mjs reference-design-preview --root PROJECT --input INPUT_JSON --out FRESH_PROPOSAL_JSON
node scripts/coherent.mjs reference-design-adopt --root PROJECT --input INPUT_JSON --decision SPEC_DECISION_JSON
```

An explicit `parentBatchSha256` in the input selects the separate late
decomposition path. The v4 project must be ready to deliver a settled current
coherent batch. Every parent source must have a known technically passing
result. The revision preserves the exact accepted reference bytes and leaves
the parent reference, attempts, source plans and coverage records in place.
The project permits one late revision and records it separately even when the
early decomposition was used. Late reference acceptance requires deferred
source planning and new observation coverage. The pinned parent delivery
remains available for read-only verification.

After freezing the new batch, `late-reuse-preview --asset ID` prepares a
zero-call rebind for an unchanged source responsibility in the pinned parent
batch. `late-reuse-adopt --asset ID --options JSON` takes `proposal`, `receipt`,
`rebindId` and `batchId`. The receipt binds the exact rebind proposal. The same
journal replays the original source or preparation, requires the same reference
pixels and style, and reruns technical QA against the new target. Changed
responsibilities and added assets keep their fresh plans. Approve the final
batch digest only after all selected rebinds. The existing reservation and
unknown-outcome rules apply to every remaining request.
