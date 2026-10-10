# UI Layer Harness execution defaults

- New UI automation runs must use `generationMode=sheets`. Explicitly select
  `sheets` in host configurations and `--generation-mode sheets` in CLI commands;
  do not override the default with `single`.
- Keep delivery materials independent. The deterministic sheets compiler may
  retain a standalone request for a background or incompatible material; that
  does not change the job's generation mode to `single`. Do not force unrelated
  artwork into a sheet merely to eliminate standalone requests.
- Before compute, report both the delivery material count and the grouped image
  request count. Distinguish image generation calls from planning, review and
  body observation calls when reporting usage.
- Preserve historical frozen configurations, authorizations, responses and
  failed states. A historical `single` run must not be relabeled or converted
  into a `sheets` run in place.
