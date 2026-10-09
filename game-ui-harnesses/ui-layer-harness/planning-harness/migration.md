# Planning ownership after retirement

The UI Layer Harness owns this single planning contract directory. Its public
entry is [ui_layer.py](../ui_layer.py); the current workflow is documented in
[HOST-DELIVERY.md](../docs/HOST-DELIVERY.md).

M1 source planning, independent M2 review, compilation, immutable request
freezing, material review, foreground observation and packaging are implemented
under `src/ai_ui_layers`. The private `_core` contains the reviewed deterministic
plan validator, path/image/resource checks, legacy prompt renderer and keyed
alpha functions required by that runtime. It contains no old provider runner,
authorization state machine, PSD entry point or background service.

Old frozen jobs retain their original runtime and contract fingerprints. Moving
these files does not upgrade or resume those jobs; new jobs freeze the new paths.
See [retirement boundaries](../docs/DECOMPOSITION-RETIREMENT.md).
