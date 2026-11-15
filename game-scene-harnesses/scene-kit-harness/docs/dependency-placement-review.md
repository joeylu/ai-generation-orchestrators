# Dependency placement review

`reviewDependencyPlacement` is an opt-in deterministic diagnostic for a
compiled candidate containing a source used as another source's spatial input.
It binds the exact dependent and source plans, source PNG, sealed derivation
evidence and compiled-scene digest. For every explicitly observed native point,
it applies the actual crop, output dimensions, padding, compiled node position
and source-to-logical ratio, and compares that point with the frozen dependency
transform. Same parallax and unmodified tint/opacity are required. Drift over
the caller's bounded tolerance produces a blocked report.

The caller must replay the workflow and candidate, obtain the evidence from
that candidate and compile its exact author map before running this diagnostic.
It does not prove that arbitrary local data came from a trusted producer, find
unrecorded points, inspect visible pixels, validate occlusion or art, or enforce
a delivery gate. A passing point match is not grounding or human acceptance.
Camera, later Studio edits and real interaction need separate checks.
