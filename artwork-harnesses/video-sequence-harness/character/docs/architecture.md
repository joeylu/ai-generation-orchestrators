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
       doctor (offline setup check)
               |
       prepare original artwork (local CPU, no provider)
       foreground PNG + original/report fingerprints
               |
       foreground review + plan (no compute)
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

The Agent owns interpretation and invocation. The core owns state, deterministic
processing, validation, and packaging. Plugins own one external generation
submission and polling of that submission only.
Reference preparation runs before generation planning so background colours do
not dictate the foreground key. Ordinary input formats/backgrounds are accepted;
readiness is checked on prepared artifacts. Source defects and segmentation
setup/quality failures are separate diagnostics. No model is downloaded silently.

Docker, web/database services, worker leasing, supervisor processes, login flows,
and production handoff protocols are not architectural layers of this project.
The public decoded-handoff is not a production protocol: it contains only a raw
fingerprint, one probe artifact, one exact decoded PNG inventory, tool evidence,
and a canonical digest.
