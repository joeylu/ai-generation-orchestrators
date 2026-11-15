# Checked deep-bridge replacement

The zero-generation `previewVerifiedDeepBridgeVariant`,
`buildVerifiedDeepBridgeVariant` and `verifyVerifiedDeepBridgeVariant`
functions replay a verified scenery-addition baseline and a separately verified
coherent donor. They require an accepted, technically passing `bridge.upper`
source with the same original reference, style and checked terrain material.
The old bridge and valley instances are replaced with the new single editable
bridge/wall instance; `rear.actual`, `facility.lower` and all other compiled
nodes, terrain appearance and collision must remain unchanged. The old bridge
display image is retained in the fresh output's ancestor evidence, and the old
source workflows and variants are never mutated.

The caller must explicitly declare a native-frame placement. The check uses
the donor's sealed crop, derived image size and compiled node to compare all
four crop corners against that declared mapping within a bounded tolerance.
It does not inspect pixels or certify contact, camera coverage, source semantics
or final art. The frozen proposal needs its own intermediate review. Build and
verify replay source, output and export; actual Studio interaction and separate
human visual review remain necessary.
