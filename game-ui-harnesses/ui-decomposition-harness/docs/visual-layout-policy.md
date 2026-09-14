# Visual layout policy v1

This opt-in policy is for new reference-driven drafts. It never grants human
visual acceptance. Existing bundles retain their prior rendering defaults.

- Typography: explicitly author Arial, normal weight as the default system font.
  Preserve text, color, size and layout; remove custom fontSource when applying
  this policy. Source font identity/glyph texture is not a fidelity requirement.
  The renderer must still report the actual browser/OS environment. A source-pixel
  comparison is diagnostic, not a typography acceptance result. Excluding a Text
  node from pixel comparison does not verify its color, size or layout.
- List: itemHeight is the row interval; rowGap is the trailing paint gap. Paint
  height is itemHeight - rowGap. Content height for N rows is N*itemHeight-rowGap.
  The label and hit rectangle fit the painted row. Icon/slot children fit the
  explicitly recorded contentInsets. Give each row one main base; set List and
  enclosing ScrollView drawBackground:false when the scene already owns the panel.
  Keep a source slot only when fully inset; do not stretch/crop item artwork to
  hide overlap. Empty stretchable bases may use an explicit nine-slice derivative.
- Tabs: use separate icon and active-icon bindings, equal local anchors and
  canvases, fixed icon and label rectangles, and reference-derived visible-alpha
  height ratios. Resize icons uniformly through reuse_scaled, never nine-slice.
  Do not bake icons into tab bases. Template QA does not recognize arbitrary
  redrawn/baked icons.
- ScrollView: use true known content extent. Explicit scrollbarVisibility:auto
  hides the vertical track and thumb when contentHeight <= viewport height.
  When the reference visibly contains a scrollbar, explicitly use the existing
  scrollbarVisibility:always and record that value in the scrollViews policy.
  Visibility does not create scroll range. No-op wheel/drag must not emit scroll.
  The proportional thumb fills the usable track without overflow; use the formal
  scrollbarInsets 1.0 contract to reserve measured end ornaments. It cannot
  preserve an observed short thumb without corresponding real content extent.
  Report that gap without changing original evidence or substituting static
  pretend controls. User-authorized content-bottom whitespace may be proposed
  and applied through [explicit bottom-space planning](scroll-bottom-space-v1.md),
  using existing contentHeight and derivedTestStates, never a default overflow.
  Legacy absence keeps existing chrome. Do not invent content to match a short
  source thumb. Track, movable thumb and optional arrow controls have separate
  visual ownership; a track request must not include arrows, thumb or ornaments
  owned by another role. The current adapter does not provide dedicated scrollbar
  arrow-button semantics: add support before delivering those as interactive
  arrows. Alpha/geometry checks cannot prove that arbitrary ornaments are absent.
- ProgressBar: a full-range fill texture may extend beyond its fillClip, but the
  clip must be contained in that texture and in the recorded track inner cavity.
  Runtime clips the cavity from zero to full width. Keep frame pixels outside the
  cavity untouched. v1 supports a rectangular mask; use an inscribed rectangle
  for chamfered/rounded slots. Exact curved or alpha masks are not implemented.

`python -m ai_ui_decomposition.visual_policy --bundle APPLIED.json --policy
POLICY.json --output FRESH.json` checks explicit type coverage, default typography,
row paint height, slot containment, tab alpha proportions/label separation/state
anchors, progress inner bounds and scrollbar semantics. A failure exits nonzero.
It does not infer component semantics from raster art or grant visual approval.

Plans may retain a verified source asset solely as the source of a placed
reuse_scaled asset. The original need not also have a painted node. Orphan assets
still fail UNUSED_ASSET; original generation sizes and cache fingerprints remain
immutable. Package generation and evidence remain owned by deterministic tools.

Optional resize.preserve_alpha_margin:true retains one real source pixel outside
the Alpha bounding box, where available, during nine-slice fitting. It never erases
opaque artwork or synthesizes a transparent border. Legacy fitting is unchanged.
