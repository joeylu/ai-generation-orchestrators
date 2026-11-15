# Optional perimeter topology guide

For a new reference-defined, bounded-native full-perimeter batch, the local
planner may explicitly set `topologyGuideProfile: 'neutral-perimeter-topology-v1'`.
This freezes a deterministic role-specific transparent occupancy diagram as
the third input, after the original reference and checked native material. An
adapter must declare support for at least three input images. Each diagram's
gray region indicates the local inward solid side; transparent space indicates
exterior. Its rectangular bounds are illustrative diagram cuts, not a request
for a platform, color, material, specific contour or output crop.

Preview does not write or authorize. Freeze stores the diagram as a checked
content-addressed input; replay recompiles its identity and verifies the stored
bytes. A new plan requires fresh exact-plan compute authorization. Existing
plans and prompts without this field remain unchanged. The diagram cannot prove
that generated pixels obey the requested topology, are seamless, have a valid
collar, or pass semantic, technical or human art review. Preserve all original
PNGs and rejected outcomes; never use a failed artwork as a guide.

`neutral-perimeter-open-joins-v2` is a separate opt-in profile. Its gray solid
meets the guide image frame at continuation cuts; short white dashed bars mark
the two intended joining ends. The marks and frame cuts are diagram symbols,
not artwork or generated-image edges. The requested PNG still needs its own
transparent margin around the material and visible cut faces. V2 uses distinct
frozen prompt and guide bytes; V1 plans and receipts are never rewritten. A
diagram is a testable directional hint, not a guarantee that the image model
will obey it or that visual, collar and seam checks will pass.

For a new reference-defined natural perimeter plan, `lowerBodyProfile:
'lower-body-appearance-v1'` is a separate explicit option. It directs the three
bottom roles to match the full checked material's body construction, palette and
scale without requiring the upper cover/body transition in a lower asset. Upper
and wall roles do not bind this option and retain their existing plan identity
when their other inputs and batch ID are unchanged. Both original full images remain bound and
the option composes with either topology guide or no guide. It does not infer
missing lower forms, accept the resulting image, prove direction or seams, or
modify old plans. Review the frozen request and use a fresh plan authorization.
