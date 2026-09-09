# UI Component Harness 0.2.0-rc.1

This release candidate freezes the engine-neutral v0.2 component, appearance,
bundle, and motion contracts for integration testing.

The accepted implementation covers all 16 component types. All ten directly
interactive types change both semantic state and visible PixiJS pixels in the
full acceptance case. Playful, Premium, and Corporate motion profiles provide
an action mapping for each component type. The local consumer page supports
reference-image recognition through an optional server adapter, decomposition
ZIP and appearance-binding import, four-scheme comparison, interaction, restore,
and portable bundle export.

Only the PixiJS/Web renderer has passed runtime and browser acceptance. The
engine-neutral contracts define an adapter boundary but do not prove another
engine. Provider credentials, endpoints, state, user media, execution reports,
temporary files, and build caches are excluded from both release archives.

Promotion to `0.2.0` requires a successful consumer integration using a fresh
artifact from the upstream UI decomposition pipeline without changing these
frozen contracts.
