# Explicit local revision after a failed rereview

When the user asks for another local correction after `REREVIEW_UNRESOLVED`,
`python -m ai_ui_layers.revise_plan --source <planning-directory> --output
<new-directory> --reason <user-request>` creates a separate child run. This
optional entry point uses the existing Codex session, one model patch and one
full-candidate review. It does not rerun M1 or submit an image request.

The program verifies the parent's bound inputs, completed checkpoints, merged
candidate and failed review. It pins all parent file hashes and copies only
the reference, schema, candidate, session identifier and review inputs needed
for this revision. Original outputs are never overwritten or promoted. The
patch can modify only existing records in the affected material families;
unrelated records and global planning policies cannot change. Broader scope
requires a separately reviewed new plan.

Successful review uses the existing compiler, preflight and frozen snapshot
format, with additive lineage evidence and the revised visual plan. A failed
or interrupted call cannot be resubmitted by resuming that node. Another
revision requires a new explicit user decision and new directory. This is
not an automatic retry loop and does not authorize image generation.

Existing CLI actions and `ui_layer_composition_v1` are unchanged. Docker/Web
package consumers need no migration. A host wishing to offer this optional
planning operation must explicitly expose its parent/reason/new-output inputs;
this repository adds no host service or deployment.
