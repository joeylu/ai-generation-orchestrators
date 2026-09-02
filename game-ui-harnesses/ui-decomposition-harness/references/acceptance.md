# Acceptance evidence

The isolated predecessor was frozen after three distinct generated-reference
families passed its deterministic assembly and PSD roundtrip checks:

| Family | Image calls | PSD pixel layers | Automatic retries | Result |
| --- | ---: | ---: | ---: | --- |
| Portrait inventory grid | 34 | 56 | 0 | Passed |
| Landscape shop dialog | 23 | 26 | 0 | Passed after one bounded material correction decision |
| Ultrawide HUD and settings | 19 | 25 | 0 | Passed |
| **Total** | **76** | **107** | **0** | Layer and composite maximum error 0 |

Those runs established the coarse control-list flow, global key removal,
important-component grouping, repeated-family reuse, and layered PSD output. They
did not establish general visual understanding.

The public runtime is covered by fifteen offline tests. They exercise strict
provider-neutral plans, single-use request state, terminal indeterminate results,
global key removal including enclosed holes, uniform reuse scaling, digest-bound
visual review, background role independence from asset names, rejection of
provider-specific extension fields, actual image dimensions and resource limits,
transparent provider results, portable file-adapter handoff without premature
single-use consumption, offline doctor and self-test, assembly, and real PSD
layer/composite roundtrip. The five related
predecessor suites also pass 170 tests unchanged.

Photoshop application opening was not run during the public migration. Automatic
component-importance selection, automatic visual acceptance, recovery of hidden
pixels, and PSB writing remain outside the accepted behavior.
