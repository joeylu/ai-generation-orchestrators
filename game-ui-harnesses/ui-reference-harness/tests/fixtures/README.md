# Synthetic historical style catalog

The legacy-sample-catalog directory contains only synthetic public deliveries produced with the original ui-reference-harness-v0.7.3 source attachment (commit 86e0c3870eb3ad68cb7c8af1562d4af9273c5ee0; runtime SHA-256 d7e7365f4a79fcd0e1ef9fbd92b3fd8f67f1d772e65085ff40095ce7a6407ddd). No adapter or model was invoked. These verify unchanged rule-only historical catalog intake after new compute requires a confirmed primary image. They contain no user media, credentials, sessions or compute authorization.

Only the loose historical files are committed. Tests materialize each
`references.zip` in a fresh temporary directory with the public deterministic
STORE writer, then compare its byte count and SHA-256 with the original archive
fingerprint in `legacy-sample-catalog-zips.json`. No historical manifest, review,
image or catalog digest is rewritten. Full delivery and ZIP validation still run,
including rejection of modified archive bytes. Generated ZIPs never enter the
public source tree; the repository binary-handoff prohibition remains unchanged.
