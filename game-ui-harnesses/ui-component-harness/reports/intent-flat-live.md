# Flat intent protocol: same-image comparison

Executed 2026-09-08 using the same twenty reviewed images and frozen expected
types as [the baseline](intent-20-baseline.md). Each image received exactly one
new submission using the revised instruction. Existing analysis IDs were read
again when polling expired or failed; no business request was resubmitted.
All twenty raw results were retained. Expected types and generation prompts
were never sent to the service.

| Gate | Baseline | Flat v0.2 |
| --- | ---: | ---: |
| Valid JSON and source-bound response envelope | 7/20 | 19/20 |
| Strict contract compilation | 6/20 | 14/20 |
| Compilation and all expected component types present | 2/20 | 11/20 |
| Invalid JSON | 12/20 | 0/20 |

The remaining envelope failure returned valid JSON with the wrong source hash.
The adapter correctly rejected it. This was a model-result failure, not evidence
of an unavailable service. Five other results failed strict compilation; three
compiled results omitted their expected component type. No result abstained.

## Implementation

The model now returns a flat node list, parent references, explicit style table
and layout boxes. The deterministic decoder constructs the existing strict tree
and policy, including structural child arrays. It does not supply missing
business properties or repair new-protocol JSON. Existing v0.1 results remain
compatible. Source bytes and the complete instruction determine cache identity;
old results remain recoverable by their analysis ID.

Classification and observed-type consistency gates reject pure-image UI
fallbacks, missing claimed types, and semantic nodes hidden by zero opacity in
their own or ancestor styles. These are consistency checks on model output,
not an independent visual classifier or an occlusion detector. The bridge also
rejects additional top-level fields before sending final responses to the page.

## Per-image outcome

| Sample | Result |
| --- | --- |
| 01 Button | Compiled; expected type present; baked label retained in a cropped child image |
| 02 Switch | Compiled; expected type present; checked state true |
| 03 CheckBox | Compiled as Container/Image/Text; CheckBox missing |
| 04 RadioGroup | Compiled; selected normal difficulty and visible option labels retained |
| 05 Input | Compiled; empty value, player-name placeholder and visible maximum 12 retained |
| 06 Select | Rejected: Select options and List items reuse globally unique IDs |
| 07 ProgressBar | Compiled; value 75, maximum 100 retained |
| 08 Slider | Compiled; range 0–100, step 1, value 50 retained |
| 09 Image | Compiled as decorative Image |
| 10 Text | Compiled as Text; completion and experience labels retained |
| 11 Container | Compiled; grouped icons and numeric text retained |
| 12 Panel | Compiled as Container/Text; Panel missing |
| 13 Dialog | Compiled; expected Dialog and Button types present |
| 14 Tabs | Rejected: content references are not direct children |
| 15 List | Compiled as Button/Container/Image; List missing |
| 16 ScrollView | Compiled; ScrollView present; hidden content dimensions are not verified |
| 17 Switch/CheckBox panel | Rejected: unused style; raw controls have correct visible states but Panel is missing |
| 18 ProgressBar/Slider panel | Rejected at adapter: source hash mismatch |
| 19 Form | Rejected: unused styles; Panel returned instead of expected Dialog |
| 20 Inventory | Rejected: unused style; Panel missing and tab content references also invalid |

The Panel/Dialog ambiguity in sample 19 was noted before the baseline; it is not
retrospectively relabeled to improve this score. Unused styles violate the frozen
wire contract and are not silently removed. Duplicate IDs and missing tab
contents are not repaired or invented.

## Evidence and limits

The new input digest is
`4c58de56300886e4368a35a28f8825a6ca44493c62746418c411d810de8434c8`.
It binds identical image facts/expectations, per-image instruction hashes and
the decoder, compiler entry and adapter source fingerprints. Private provider
records, source images and detailed comparison JSON stay outside the public
package. They are not hand-edited to convert failures into successes.

Final offline verification: build, 249 unit tests, self-test, doctor and 58
browser tests passed. See the generated `intent-flat-verification.json` evidence.
Browser tests use mocks; this live trial is separate from automated tests.

The 55% score measures expected-type coverage after compilation, not complete
visual/behavioral accuracy. It permits additional types and does not prove
hidden runtime properties, editable text for baked labels, geometry or skin
fidelity. The synthetic set was used to guide this optimization, is small, and
contains one trial per image. It is not held-out accuracy or repeatability
evidence. The configured service's internal model version was not established.

Next priorities are observable-intent separation from runtime policy, explicit
Panel/List/CheckBox discrimination, and valid Tabs content ownership without
inventing hidden contents. A held-out evaluation is required before claiming
general sixteen-component stability.
