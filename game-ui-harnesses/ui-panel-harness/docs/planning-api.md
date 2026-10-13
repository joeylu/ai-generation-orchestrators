# Public planning API v1

Source package entry: `ai-ui-panel-harness/planning/v1`. This is an offline facade over the existing planner, not a separate implementation. It does not call a model, interpret requirements, validate a model response, compile PanelSpec, or render a panel.

- `PLANNING_API_VERSION`: `1.0`.
- `preparePlanning({ request, catalog, assetRetrieval?, options? })`: delegates to existing planning-context validation/retrieval and returns a JSON session containing the frozen context, native response schema, schema SHA-256 and whole-session SHA-256. Existing planning options and request/catalog contracts apply.
- `verifyPlanning(session)`: revalidates the context and regenerates its schema using the installed implementation. Rejects changed versions, unknown envelope keys, changed context/schema/digests and non-JSON inputs. Returns a fresh verified JSON snapshot; never repairs the input.

The session digest covers every envelope field except `sha256`. It detects inconsistency; it is not a signature or model-compute authorization. The API version, planning-context version and intent version are distinct. Consumers must test supported context/intent pairs explicitly. A schema/context change that breaks old snapshots requires explicit preparation of a new session while preserving the old one. Behavioral changes with an unchanged schema still require semantic regression tests.

Internal planner modules remain dependencies of this facade. They may evolve behind this entry, but this does not yet constitute an independently packaged planning engine. The release builder includes the entry and dependency closure and exports the same subpath. Previously built releases do not contain it; a fresh immutable release must be built and verified before production use.

Maintenance: keep compatible changes behind this entry, add regression coverage before widening supported protocols, and introduce a new public API version for breaking envelope/behavior contracts. Do not require consumers to copy internal planner code.

## Optional Codex adapter

`ai-ui-panel-harness/planning/codex/v1` exports API version 1.0, `prepareCodexPlanning(session, instructions)`, `runCodexPlanning(plan, options)` and the read-only login preflight. Preparation freezes session, instructions, full prompt and existing adapter model/effort in a digested JSON plan; it performs no model call.

Run requires `authorizationSha256` matching that plan, `outputRoot` and an explicit `writableRoot`. It verifies the plan and current context, checks credential visibility, then exclusively creates a plan-keyed directory. Existing directories block repeated dispatch, including after an interruption. This guard is scoped to the host's output root; consumers must keep that root stable. Runtime dependency injection is for offline tests, not a compute authorization source.

The existing tool-disabled, single-turn Codex transport owns execution, limits, terminal failures and safe receipts. The new path saves the exact final response plus parsed intent without calling the legacy PanelSpec materializer. `RESPONSE_RECEIVED` means transport completion only; schema/semantic acceptance and clarification handling belong to the consumer. It makes no automatic new invocation. Preserve failed/clarification attempts and prepare a new explicitly authorized plan to try again.

Release builder exports this optional subpath; the updated release has not been built/accepted. CLI structured-output approach is consistent with the [official Codex example](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex); this adapter intentionally has no iterative repair loop.
