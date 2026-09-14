# Functional draft material audit v1

`material-audit --run-dir RUN --output FRESH [--observations FILE]` performs offline exhaustive material triage and produces a digest-bound repair proposal. No generation, retry, manifest mutation or export occurs. It can inspect a verified batch after `process` stopped at its first invalid material.

The `functional-draft-v1` profile treats texture, minor color and font-style differences as warnings. Font size, layout and legibility still require runtime checks. Empty or nontransparent interactive assets, invalid thin-control proportions, baked state parts, wrong semantic assets, layout overflow, state misregistration, unreadable text and interaction failures remain blocking. Uncertainty requests evidence review, not automatic replacement or acceptance.

Optional observations have kind `ai_ui_material_observations_v1`, `plan_digest`, and `findings`. Each finding names `asset`, `raw_sha256`, `category`, `observer` (human/model/local-check), and nonempty `evidence`. Categories are `texture_difference`, `minor_color_difference`, `font_style_difference`, `baked_state_part`, `wrong_semantic_asset`, `layout_overflow`, `state_registration_error`, `text_unreadable`, `interaction_failure`, or `uncertain`. Observations are caller evidence, not an automatic semantic detector; their digest and source hashes are retained.

Outputs distinguish replacement proposals, evidence review and reuse candidates. Reuse candidates are not visually approved. The proposal is not an executable generation plan or compute authorization. Freeze any replacement plan and obtain its fresh digest-bound authorization under the existing contract. This command does not implement unattended repair compute.

Existing strict processing, reference evidence, consumer import and actual-input acceptance remain required. This profile does not reinterpret historical failed region comparisons as passes or grant human visual acceptance. Texture differences alone should not motivate replacement requests under this profile.

## Compile a replacement plan

`material-repair-plan --run-dir RUN --source-plan ORIGINAL_PLAN --audit AUDIT_JSON --output FRESH_PROJECT --id NEW_ID [--reuse-source-run ORIGINAL_RECEIVED_RUN]`

This offline command verifies the frozen plan, audit digest, full generated-asset coverage and raw fingerprints. It maps supported defects to additional prompt constraints, preserves target geometry and semantic inputs, and adds the existing `cached_result` field for reuse candidates. Original reference bytes and imported materials are copied from allowlisted, hash-verified source-plan inputs. Additional source runs resolve original received records for assets previously reused; reuse chains are not accepted.

Supported automatic strategies currently cover thin-control aspect, missing transparent pixels, baked state parts and wrong semantic objects. Unknown observations and unsupported defect types fail explicitly. Cosmetic differences do not create replacement requests. The output includes `plan.json` and `repair-plan.json`, with the exact maximum call count and zero automatic retries. The command neither freezes nor submits the plan; use the existing freeze/reuse commands next, then obtain fresh authorization for that frozen digest. No speculative multi-round compute budget is implied.
