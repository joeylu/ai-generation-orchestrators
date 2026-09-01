# Agent intent and deterministic compiler

The optional Intent layer gives an Agent a structured way to describe a
character motion before the immutable video plan is created. It is not required
for existing integrations: a caller may continue to author the original
`job.json` contract and invoke `plan` directly.

## Responsibility boundary

The Agent or an external LLM may propose only the semantic draft:

- subject traits that must be preserved;
- action type and motion goal;
- required, optional, and locked motion;
- amplitude and semantic continuity;
- ordered key poses;
- subject translation, subject turn, and camera motion.

The deterministic CLI binds that untrusted draft to the exact user request and
the verified reference evidence. The Agent must not invent image digests,
preparation digests, or `intent_sha256`.

`intent build`, `intent validate`, and `compile` do not contact an LLM, provider,
ComfyUI, or private service. They do not generate media and do not consume the
one generation authorization.

## Flow

Start with the existing workspace `job.json` and, for opaque artwork, a reviewed
neutral preparation handoff. An Agent writes `work/motion-draft.json` containing
exactly these five top-level fields:

```json
{
  "subject_preserve": {"value": ["identity", "proportions", "palette"], "source": "automatic_policy", "rationale": "Visible reference traits."},
  "action_type": {"value": "idle", "source": "explicit_natural_language", "rationale": "The user requested idle."},
  "motion_goal": {"value": "A subtle idle motion", "source": "explicit_natural_language", "rationale": "The user's motion request."},
  "motion_contract": {
    "must_move": {"value": ["subtle body rise and fall"], "source": "automatic_policy", "rationale": "Conservative idle policy."},
    "may_move": {"value": [], "source": "automatic_policy", "rationale": "No optional secondary motion is required."},
    "must_lock": {"value": ["identity", "palette"], "source": "automatic_policy", "rationale": "Preserve character identity."},
    "amplitude": {"value": "subtle", "source": "automatic_policy", "rationale": "Conservative idle policy."},
    "continuity": {"value": "seamless_loop", "source": "automatic_policy", "rationale": "An idle is delivered as a loop unless the user says otherwise."},
    "key_poses": {"value": [], "source": "automatic_policy", "rationale": "No required key pose."}
  },
  "spatial_contract": {
    "subject_translation": {"value": "stationary", "source": "automatic_policy", "rationale": "No translation was requested."},
    "subject_turn": {"value": "locked", "source": "automatic_policy", "rationale": "No turn was requested."},
    "camera_motion": {"value": "locked", "source": "automatic_policy", "rationale": "No camera motion was requested."}
  }
}
```

Bind and validate it without compute:

```powershell
ai-frame-animation intent build `
  --root my-animation `
  --request "A subtle idle loop" `
  --draft work/motion-draft.json `
  --job job.json `
  --prepared-reference work/reference/r001/handoff.json `
  --out work/motion-intent.json

ai-frame-animation intent validate --input my-animation/work/motion-intent.json
```

For a meaningful transparent input that does not need preparation, omit
`--prepared-reference`. The program then binds source and foreground to the same
verified image bytes and records a null preparation digest.

Compile the intent into a fresh job; the original template is never overwritten:

```powershell
ai-frame-animation compile `
  --root my-animation `
  --intent work/motion-intent.json `
  --job job.json `
  --prepared-reference work/reference/r001/handoff.json `
  --out work/compiled-job.json

ai-frame-animation plan `
  --root my-animation `
  --job work/compiled-job.json `
  --prepared-reference work/reference/r001/handoff.json `
  --out work/plan.json
```

The Compiler is provider-neutral. It does not emit endpoints, model IDs,
resolution profiles, watermark flags, workflow paths, or provider credentials.
The existing `plan` stage independently selects a safe key colour from the
verified foreground and binds the compilation report into the plan digest.

## Clarification and repair policy

An external LLM adapter may request clarification when the subject or requested
motion is ambiguous. It may make at most one format-only repair of malformed
structured output. It must not turn a genuine semantic conflict into a guessed
answer. Those transport and model calls remain outside this package; the public
CLI only validates their materialized draft.
