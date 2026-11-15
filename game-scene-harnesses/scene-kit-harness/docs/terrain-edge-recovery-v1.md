# One failed native perimeter role

Use this explicit recovery only for one known `rejected-technical` native
terrain-edge result in the current full seven-role perimeter batch. Preserve
its original PNG, result, failed QA and consumed authorization. An indeterminate
attempt uses the explicit terminal-bound variant below. All other roles must be checked sources (including
explicitly accepted canvas-gutter preparations) or unchanged, unused authorized
requests. Other preparation types are outside this version's scope.

`recovery-preview` is read-only. `recovery-freeze` appends one new immutable plan
and one recovery batch, without authorizing, reserving or invoking anything.
The new plan has a distinct ID and digest and names the failed plan as its
parent. Its role, brief, appearance, input order, PNG identities and exact request
must remain identical. A prompt or input revision requires its own supported
planning flow; this command cannot introduce it. Historical parent-free plans
retain their exact bytes and QA policies.

Options JSON contains exactly:

```json
{
  "parentBatchSha256": "CURRENT_FULL_PERIMETER_BATCH_SHA256",
  "failedPlanSha256": "FAILED_NATIVE_PLAN_SHA256",
  "planId": "perimeter.bottom.replacement",
  "batchId": "perimeter.recovery"
}
```

Run the local `scripts/terrain-edges.mjs` commands:

```text
recovery-preview --workflow WORKFLOW --options JSON
recovery-freeze --workflow WORKFLOW --options JSON
compute-review --workflow WORKFLOW --batch NEW_BATCH_SHA256 --out NEW_REVIEW
```

The exact review packet separates **one new image request** from the remaining
original authorizations. It contains the new plan, exact prompt and original
input PNGs, the failed source/result, and checked-source and continuation
identities. Exporting or replaying the review never authorizes compute.
Obtain a fresh single-use confirmation bound to the new batch or replacement
plan, including any increased overall budget. Never reuse the failed attempt's
receipt or reauthorize unchanged requests. Reserve durably before the one call.
The replacement must pass before batch dispatch can continue with the original
unused requests. Any technical failure or unknown outcome stops the batch.
There is no automatic retry or queue. Resume an interrupted freeze with the
same exact options only if its plan alone was durably written; do not refreeze
an already completed recovery batch.

A painted nonzero-Alpha surround is a source failure, even if no pixel is fully
opaque. Inspect the bound true-Alpha checker, white and dark reviews. Never
erase white, threshold Alpha or use two-pixel padding to qualify a source whose
empty canvas is painted. The existing gutter preparation remains limited to
its sole eligible failure, weak border and visible-body margins.

Technical reception does not establish native collars, repeat windows, feature
scale, bridge joins or actual Studio appearance. Measure and recompose checked
sources before delivery, and keep source and final human art acceptance
independent. Original maps and user edits are not changed by recovery planning.

Offline regression: `tests/terrain-edge-recovery.test.mjs` covers transparent
canvas preparation reuse, a painted partial-Alpha failure, exact-request
identity, fresh confirmation, preserved unused authorizations, ordered dispatch,
failure/unknown stops and immutable historical evidence. No test generates media.

## Explicit replacement after an unknown outcome

Use the same preview and freeze commands with the additional `terminalSha256`
field bound to the recorded `indeterminate` terminal event for
`failedPlanSha256`. The new batch links that terminal event and attempt digest.
Its review packet contains the terminal record and one distinct executable plan.
The original unknown attempt stays terminal. Obtain fresh authorization for the
new batch digest before dispatch. Other roles retain their checked results or
unused authorizations and can dispatch after the replacement passes technical
reception. Use the explicitly selected local image transport for the new attempt.

For the installed Codex CLI transport, `run-codex` dispatches one authorized
request using the existing local ChatGPT login. Choose a private transport
directory with an existing parent and a fresh exchange directory for each
invocation. On Windows use a short transport path so the attempt digest fits
in the CLI working directory.

```text
node scripts/terrain-edges.mjs run-codex --workflow WORKFLOW --batch BATCH_SHA --out NEW_EXCHANGE --transport-workspace PRIVATE_DIRECTORY
```

If the exchange already contains `adapter-return.png` and local reception was
interrupted, use `receive` on those exact bytes and the existing exchange.
