# Generation and processing state

Generation attempts and deterministic processing revisions are separate.

```text
DRAFT -> PLANNED -> AWAITING_CONFIRMATION -> AUTHORIZED
  -> GENERATING -> RAW_READY
  -> PROCESSING -> VALIDATING -> SUCCEEDED | WARNED | FAILED
```

## Generation attempt

- An authorization is single-use and bound to one immutable plan SHA-256.
- The program atomically consumes authorization before provider submission.
- `RAW_READY` requires a raw-video artifact and SHA-256.
- If submission may have occurred but no trustworthy result exists, record
  `GENERATION_INDETERMINATE`. It is terminal; never resubmit automatically.
- A known pre-submission failure may end as `GENERATION_NOT_SUBMITTED`. A new run
  still requires a new authorization.

## Processing revision

- A user-supplied video may enter here after planning without a generation
  attempt or generation authorization. Do not fabricate a `RAW_READY` attempt
  record for an imported video; the processing manifest owns its fingerprint.
- Processing starts only from a fingerprinted raw video.
- Each revision records the raw SHA-256, tool version, parameters, selected source
  timestamps, artifact SHA-256 values, and quality result.
- Reprocessing the same raw source is allowed and creates a new revision; it does
  not mutate or replay the generation attempt.
- All requested frame-count variants share the raw identity, probe, decoded frame
  set, and source timeline.
- A verified decoded handoff is processing evidence, not a generation state. It
  permits deterministic reprocessing of the same raw digest and never permits a
  provider resubmission.

## Terminal quality

`SUCCEEDED` means the selected policy passed. `WARNED` is available only under an
explicit `best_effort` policy and cannot waive hard invariants. `FAILED` preserves
evidence and does not trigger generation retry.
