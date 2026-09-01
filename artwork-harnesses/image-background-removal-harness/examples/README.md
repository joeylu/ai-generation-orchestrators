# Background-removal examples

`segmentation.config.example.json` documents the single BiRefNet CPU profile.
`segmentation-fusion.config.example.json` documents the serial BiRefNet + IS-Net
enclosed-hole profile. Copy one configuration into the caller's ignored
workspace and replace its model paths with locally verified files.

Both examples use the same `prepare --config` entry. Neither downloads weights,
uses GPU, calls a service, or selects a model per image. See
[reference preparation](../docs/reference-preparation.md) for verification,
limitations, and the required visual review.
