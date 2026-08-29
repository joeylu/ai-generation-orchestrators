# Architecture

The public project separates Agent reasoning, generation plugins, and deterministic
delivery code.

```text
User request + character references
               |
               v
        Agent skill / job JSON
               |
       init + self-test (no compute)
               |
       tools check (offline)
       tools install (explicit setup only)
               |
       doctor + plan (no compute)
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

The Agent owns interpretation and invocation. The core owns state, deterministic
processing, validation, and packaging. Plugins own one external generation
submission and polling of that submission only.

Docker, web/database services, worker leasing, supervisor processes, login flows,
and production handoff protocols are not architectural layers of this project.
