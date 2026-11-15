# Checked bridge and valley-band variant

`previewVerifiedBridgeBandVariant`, `buildVerifiedBridgeBandVariant` and
`verifyVerifiedBridgeBandVariant` are a narrow, zero-generation assembly path.
They replay an existing checked sky/terrain variant and a separate coherent
candidate, require accepted technically passing bridge and valley sources from
the candidate's batch, and bind the same reference and style. The bridge may be
a checked rebind. The band must have an explicit full-native-frame placement
whose camera and parallax match the baseline. Both instances must be new IDs on
the same existing donor layer. A fresh layer directly above the baseline rear
layer retains its parallax; compiled order must put rear behind the bridge and
the band in front of the bridge.

The new author map preserves `rear.actual`, removes the previous
`rear.facilities.actual` instance and adds the two independently editable
instances. Source PNGs, unrelated modules, terrain appearance and collision
are checked against their inputs. Build uses a fresh output and exact proposal
review; verification replays inputs, outputs, inventory and export. The report
is a technical candidate, not a production or art-acceptance claim. Independently
inspect source content, bridge contacts and camera coverage, and exercise the
actual Studio brushes and project import/export before human final review.
