# Architecture

The public project separates Agent reasoning, generation plugins, and deterministic
delivery code.

```text
User request + character references
               |
               v
        Agent skill / job JSON
               |
 optional semantic draft -> intent build/validate -> deterministic compile
               |                (no LLM/provider call inside the CLI)
       init + self-test (no compute)
               |
       tools check (offline)
       tools install (explicit setup only)
               |
       doctor (offline setup check)
               |
       transparent source OR reviewed neutral handoff
          ^                         ^
          |                         |
 optional local background CLI   optional MCP/service
          +---- materialized original/foreground/report ----+
                                  |
       foreground review + plan (no video compute)
               |
        one user confirmation
               |
               v
  core attempt log -----> optional provider plugin
       |                    submit exactly once
       |                           |
       +<--------------------- raw video
       |
       v
 fingerprint -> probe -> decode once -> shared source timeline
       |             ^
       +-> verified decoded-handoff from a deterministic adapter
                                  |
                         +--------+--------+
                         |        |        |
                       16f      32f      64f
                         |        |        |
                         +--- RGBA / align
                                  |
                     PNG + atlas + GIF + manifest
                                  |
                         strict / best_effort
```

The Agent owns interpretation and invocation. When structured interpretation is
used, the Agent proposes semantics while the core binds request/reference
evidence, validates conflicts, compiles the prompt, and fingerprints the result.
The core also owns state, deterministic processing, validation, and packaging.
Plugins own one external generation submission and polling of that submission only.
Reference preparation, when needed, runs before generation planning so background
colours do not dictate the foreground key. It is not part of the video package.
The video runtime verifies `ai_reference_preparation_handoff_v1` without importing
or naming its producer. Source defects and segmentation setup/quality failures
remain producer diagnostics. No local model is downloaded silently.

Docker, web/database services, worker leasing, supervisor processes, login flows,
and production handoff protocols are not architectural layers of this project.
The public decoded-handoff is not a production protocol: it contains only a raw
fingerprint, one probe artifact, one exact decoded PNG inventory, tool evidence,
and a canonical digest.
