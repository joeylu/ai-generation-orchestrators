# Second real Button acceptance — 2026-09-08

The user supplied a new local purchase-button image and explicitly selected a
`gpt-5.6-luna` subagent with `xhigh` reasoning for conversational visual analysis.
One independent subagent inspection returned a strict v0.1 whole-image Button
intent with baked text “购买”. The root reviewer accepted it after inspection.
This is a conversation subagent run, not an online vision API integration.

Source SHA-256:
`88def71ade90063639bf0add5dffa758a6dc0a3ef5146a0e88eee6f08beb7b46`.
Original byte count: 55,016. Browser-decoded size: 272 × 128.
The original green button, cut corners, gold border, text and light background
are preserved. No separate text, background removal or new artwork was generated.

Explicit preview policy: 640 × 400 canvas, centered, scale 1, enabled true.
Browser and CLI compilation agree on layout `{x:184,y:136,width:272,height:128}`.
These settings are engineering inputs, not visual observations of the source UI.
The supported template emits `activate`; no purchase transaction or business
callback is inferred from the label.

| Executed check | Result | Evidence |
| --- | --- | --- |
| Luna visual intent and one-attempt source-bound analysis ledger | PASS | Strict intent validated; source digest matched |
| Browser import, real decode and PixiJS compilation | PASS | `purchase_button_01`; 1 instance / 6 listeners |
| Real mouse click | PASS | One activate and pressed → hover lifecycle |
| Press, drag outside button and release | PASS | No additional activate; state normal, no pressed pointer |
| Disabled real click | PASS | State disabled; no additional activate |
| Legacy cancellation / multi-pointer / reload probes | PASS | 14/14, including 20 sequential reloads and concurrent load |
| CLI compile / validate / pack / unpack | PASS | Exit code 0; original and extracted image SHA-256 equal |
| Full page reload then bundle import | PASS | Exact compiled contract restored from embedded bytes |
| Real click after bundle restoration | PASS | One activate; 1 instance / 6 listeners |

Artifacts are local user data in the repository's ignored
`.tmp/ui-purchase-88def71a/`: the unmodified image, Luna intent/review, explicit
policy, program-created analysis ledger, compiled document, portable bundle,
and artifact checksums. They are not added to public fixtures or release archives.

This establishes a second real whole-image Button input. Real composite artwork,
editable layers, physical touch/pen, native IME panels and user visual signoff
remain unverified. Online model API and other engine adapters remain unconfigured.
