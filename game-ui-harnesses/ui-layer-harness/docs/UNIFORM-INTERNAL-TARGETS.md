# Uniform artwork with internal geometry targets

New final-composite-first warning runs bind
`layoutInternalTargetsPolicy=uniform-internal-targets-observe-only-v1`.
An illustrated card may declare visible divider and section-band coordinates
while retaining `mode=uniform`. These targets guide generation and remain in
the post-render measurements. They never authorize internal warping, independent
axis scaling, or acceptance of unresolved geometry. Frame declarations retain
their existing piecewise registration behavior. Historical configurations with
no internal-target policy retain the former frame-only target validation.

Fresh M1 declarations are checked before preparing M2: reference identity,
material ownership, constraint endpoints, ordered targets, and target bounds
must pass. The same checks still run when freezing the reviewed snapshot.

A terminal failure is never resumed or relabeled. An integrity-verified,
independently reviewed snapshot may be supplied to the existing explicit
`verified-planning-snapshot-reuse-v1` workflow for a separate delivery task.
This does not count as a successful first attempt or new planning, and must
not change prior responses, authorizations, or failure records.
