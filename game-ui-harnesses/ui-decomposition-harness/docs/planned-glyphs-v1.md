# Native planned glyph derivation 1.0

Native delivery input `1.2` can declare a monochrome Tabs state glyph that the
local handoff producer derives from its paired canonical glyph. This is a
deterministic material step. It does not create another image request or add a
consumer appearance field. Inputs `1.0` and `1.1` keep their existing schemas.

The top-level `derivedGlyphs` field is required for `1.2` and is an array, which
may be empty. Every entry has exactly these fields:

```json
{
  "targetLayerId": "combat-active-icon",
  "canonicalLayerId": "combat-icon",
  "paletteReferenceRect": [88, 64, 4, 4],
  "evidence": "The target tab icon is a single-color state of this same glyph."
}
```

Both layers must belong to the same Tabs component and the same `tabId`; their
roles must be the paired `icon` and `active-icon` roles. The target must be the
opposite role from the canonical source. The two source rectangles must have
the same dimensions. Unknown layers, cross-owner or cross-tab references,
shared-source references, chains, cycles and duplicate targets are rejected.

`paletteReferenceRect` uses original-reference pixel coordinates, has at least
2 by 2 pixels, and must stay within the SHA-verified original PNG. It may point
to any explicit ROI. This permits a source color to come from another visible
glyph while keeping the glyph relationship
itself bound to one owner and tab. Every sampled pixel must be fully opaque, and
the maximum per-channel range must be at most 12. The median RGB is stored with
an SHA-256 of the ROI pixels. This makes the color an explicit source
observation rather than an inferred palette.

The target layer remains in the material catalog and appearance binding, but it
does not occupy a generation slot. The canonical layer still follows its
declared generated-material route. During handoff, the producer rechecks the
compiled original SHA and ROI, then requires a same-size canonical PNG with
transparent and opaque pixels. At least nine canonical pixels must be opaque,
and the 5th-to-95th percentile RGB spread must be at most 48. It writes the
target RGB from the saved palette while copying canonical Alpha bytes exactly;
transparent RGB is zeroed. If the resulting decoded RGBA pixels equal the
canonical pixels, the materializer rejects the state as not distinct.

The compiler binds the recipe digest into every frozen generation prompt and
writes `planned-glyphs.json`. Normal `prepare_handoff` and sourced material
handoffs use the same deterministic materializer. The prepared
`derived-glyphs.json` records the recipe and plan digests, original-reference
SHA, palette ROI and pixel SHA, canonical material SHA, palette RGB, output
PNG SHA and Alpha SHA. A changed compiled plan, reference or palette ROI fails
before the target is packaged.
For sourced handoffs, the source declaration that supplies the canonical
generation asset must include `expectedRawSha256`; the existing verified-run
check confirms that raw digest before extraction. Other sourced assets keep
their existing rules.

The compiler appends a `contract-derived` entry to the compiled
`acceptance-scope.json` for each derived target, including the target and
canonical layer IDs, recipe version, palette ROI and original-reference SHA.
It preserves the supplied
reference state, state evidence and original reference bytes. This derived
state means a solid-color regression target; it does not claim that an
independent alternate silhouette was observed or recover details omitted from
the canonical glyph.
