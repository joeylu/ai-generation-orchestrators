# Synthetic side-view contract fixtures

`synthetic/` is produced by `scripts/fixture-source.mjs`, not by a generative model.
It contains 47 topology-role PNGs, one environment marker, one repeat-strip marker,
two assembly presets, a four-screen default map and a 47-case inspection map.

The pictures are flat program graphics for contract checks. They provide no art,
seam, gameplay or human visual acceptance evidence. The optional local Studio
uses them for editor and repeat-coverage engineering checks, not final-art acceptance.

Run `node scripts/build-fixtures.mjs --check` from the Harness to verify every
checked-in byte against the deterministic producer without changing files.
`--output NEW_DIRECTORY` materializes another copy and refuses existing targets.
Never hand-edit the generated kit descriptor, file hashes or fixture sources.
The tests mutate isolated temporary copies to exercise rejection behavior.
