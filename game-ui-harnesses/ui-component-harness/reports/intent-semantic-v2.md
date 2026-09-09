# Semantic observation v0.2 revision

Subsequent live evaluation is recorded separately in the
[frozen same-image retest](intent-semantic-v2-live.md): original set 13/20,
added set 4/4. The statements below describe the implementation-only checks.

This revision addresses protocol failures found in the first staged trial. It
does not change that trial's results or establish a new live success rate. The
single-stage adapter remains the local default; staged recognition is opt-in.

## Changes

- A versioned observation vocabulary records only semantic fields. Text rendering
  enums, image rendering fields, Slider step and ScrollView metrics are no longer
  requested during observation. Unknown optional properties may be omitted.
- Semantic parenting can associate a progress label with its control. The final
  render tree must retain both nodes under the same allowed composite ancestry.
- Immutable preview policy v1 explicitly requires interactive controls to be
  enabled, Input to be editable with a 1024-character limit, Dialog to be nonmodal,
  and Text to use no wrapping with clipping. These are preview choices, not
  claims about source business behavior. The validator rejects omitted or
  conflicting policy values; it does not insert defaults.
- New staged jobs require observation v0.2. Old v0.1 envelopes retain their
  original validation semantics and cannot downgrade a new pipeline.
- Contract instructions explicitly distinguish document, node, style and entry
  IDs, and bind the selected policy into the template fingerprint.
- Cached observation and contract instructions must match their actual digests
  and the expected stage instruction. Self-consistent substituted prompts are
  rejected before a new contract submission.

## Evidence and limits

Offline fixtures reproduce the progress-label hierarchy failure, rendering-field
coupling, missing or conflicting preview settings and protocol downgrade. They
also exercise immutable submission identity and clearing a previously successful
canvas when a later policy validation fails. These are regression fixtures, not
repaired live outputs or a rescoring of the original trial.

Executed checks are recorded in `intent-semantic-v2-verification.json`.
After the cache-binding review fix, the full unit suite passed again (278 tests)
and the build passed; this adds two cache regressions to the initial unit run.
No new image generation or provider submissions were made for this revision.
CheckBox classification, missing Panel identification, hidden tab content and
pixel fidelity still require independent acceptance. Slider step and unknown
required semantic values still have no invented fallback.
