# Explicit relative whole-body fit tolerance

New approximate host runs may opt into
`uniform-observed-body-relative-residual-v3`. It resolves a frozen relative
corner-error allowance against the **reference complete-body diagonal**, with
an explicit pixel floor and absolute cap. It changes acceptance tolerance,
not the measured boxes or the single uniform transform.

```json
{
  "bodyFitPolicy": {
    "kind": "uniform-observed-body-relative-residual-v3",
    "maximumResidualFraction": 0.04,
    "minimumResidualPixels": 4,
    "maximumResidualPixels": 64,
    "denseBoundaryMarginPixels": 4
  }
}
```

This is an explicit policy example, not a new implicit default. Integrated host
jobs without an explicit policy retain their existing defaults. Historical v2
policies retain their fixed pixel threshold and report format. Strict visual
policies cannot opt into approximate body fitting.

For reference body size `(w, h)` the effective ceiling is
`min(maximumResidualPixels, max(minimumResidualPixels,
maximumResidualFraction * hypot(w, h)))`. The relative fraction must be finite
and greater than zero, at most 0.05. The pixel floor is finite, between zero
and eight, no greater than the absolute cap. The cap retains the existing finite
0..128 range. Native boundary measurement allowance retains its existing 0..8
integer range and its distinct meaning.

The program still uses one centered least-squares scale for both axes and reports
the actual fitted size, corner error, normalized error, reference diagonal,
effective ceiling and frozen policy. It retains the existing 25% coarse aspect
guard, complete-body and ownership assertions, native-alpha coverage checks,
full-support storage, exact source fingerprints, independent material review
and package replay. It never stretches an axis, deletes alpha or supplies
different observer coordinates to fit a threshold.

Reviewers must still report major or uncertain deformation, missing content,
duplicates and wrong states. Passing a numerical geometry rule does not
reclassify a visual blocker or grant human acceptance. The relative policy does
not repair generated proportions or guarantee that a future image will pass.
Generation continues to request preservation of the bound reference's complete
owned contours and proportions; planned crop dimensions remain locators and
must not be relabeled as measured semantic body dimensions.

This acceptance-policy change requires a fresh frozen scope and its user
authorization before new real calls. It cannot resume an old failed job, reuse
its authorization or upgrade an archived diagnostic to formal success. An
offline replay of old measured dimensions is only policy arithmetic evidence.
