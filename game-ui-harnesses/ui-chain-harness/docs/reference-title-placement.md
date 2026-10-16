# Reference title placement

`surfaceBand: reference-v1` keeps its existing artwork selection, end caps and
horizontal band drawing. Two separately versioned runtime policies improve the
text of explicit reference main titles without rewriting a skin or document.

`opaque-title-center-v1` uses verified source pixels only. A single normal,
fully opaque replacement title layer must qualify for the existing reference
band path, with no explicit layer size, offset, scale change or tiling. Its
largest alpha >= 240 central rectangle must cover at least 80% of the selected
source width and 50% of its height. The runtime maps that body through the same
sourceRect and clip box used to draw the band. Only a body center differing by
more than two logical pixels changes text placement. The resulting y is clamped
inside the original authored safe box after the original text-fit check.

The safe box, source PNG/crop, font, font size, ink precedence and horizontal
alignment stay unchanged. Sections, missing explicit text insets, unmarked
documents, ordinary base-role surfaces, complex layers, translucent bodies and
insufficient evidence keep their original placement. Long titles do not gain
extra fit space: if a requested correction cannot fit, the position is clamped
and its remaining error is recorded; an original fit error still fails.

`cjk-title-orphan-balance-v1` applies only to reference main titles with centered
word wrapping, no authored newline, at least 70% Han characters and an automatic
single-Han final line. Real `CanvasTextMetrics` measures at most 32 candidate
wrap widths plus the original. A candidate must retain the original line count,
fit completely in the original box and improve line-length balance. Only the
wrap width changes; the authored string and font size remain exact. Resizing
starts from the full current safe-box width each time. The previous closing
punctuation policy remains the default unchanged.

Short body copy can separately opt in to `cjk-body-short-tail-balance-v1` through
the existing explicit `referenceTextFlow` scope. It requires no authored newline,
at most 64 characters, two automatic lines, and a final line containing just
one Han character with up to two closing punctuation marks, or one to two
closing punctuation marks alone. An empty tail never qualifies. It retains the same
string, font, box, line count and fit checks, with at most 32 candidate metrics.
Other body copy falls back to the original closing-only policy. Preflight and
actual text use the same opt-in path; legacy body text remains unchanged.

Text runtime evidence exposes `runtimeTitlePlacement` (policy, material SHA,
source and opaque rectangles, mapped body, safe box, requested/applied y,
remaining offset and clamp) and `runtimeTitleWrap` (policy, before/after lines,
wrap width and measurement count when changed). These are derived runtime
observations, not fields added to a saved PanelDocument or skin manifest.
Changed short body copy also exposes `runtimeBodyWrap` with its separate policy
and before/after lines. Returning to a width without an orphan clears that hint.

An old consumer's bundled runtime and its frozen preview/check evidence are
retained exactly. An official runtime refresh produces a new consumer/source
fingerprint before new derived previews are checked. Existing model plans,
responses, image sources, source proofs and historical check reports must not be
rewritten to appear to have used the new policies. Replaying an old response
with the refreshed runtime is a new deterministic result and must retain its
own source fingerprint and visual-review status.
