# Remaining UI samples — 2026-09-12 preflight

The user confirmed the five-image integration set under the ignored workspace
`work/ui-component-harness/samples/decomposition-input-r001`. Remaining execution
order: `01-inventory-shop.png`, `03-battle-hud.png`, `04-reward-dialog.png`.
This is not the older four-image decomposition candidate set.

Inventory needs Tabs, List, vertical ScrollView, Button and the visibly present
ALL ITEMS Select, plus static artwork/text/panel/progress roles. HUD needs Slider
acceptance added before generation; reward needs Dialog acceptance. Neither
missing adapter is implemented by this preflight.

The user requested stable automatic rules instead of per-sample questions about
unseen content. Added the explicit visible-only planning policy documented in
[visible-content-policy.md](visible-content-policy.md). It derives extent from
known item bounds, never the reference thumb texture, and retains exactly known
Select choices. It produces facts-bound proposals, not acceptance receipts.
No-overflow inventory becomes a full-track thumb and zero scroll; the mismatch
with the source short thumb remains explicit. Unseen popup art is contract-derived.

Executed validation:

- Original checkout baseline: 132 tests passed, including opt-in real-browser
  stateful cases (21.349 seconds).
- After policy addition: 137 tests passed, including the same real-browser cases
  and five new local policy tests (22.816 seconds).
- `git diff --check` passed. No provider calls occurred.
- Earlier environment-only baseline had 24 errors and one skip because the
  selected environment lacked the optional PSD dependency. The failed log is
  retained; the complete existing local Python environment resolved setup.

Fresh inventory proposal is in
`work/ui-decomposition/inventory-shop-fullchain-20260912-r001`.
The official CLI initialized the original reference, validated and froze a plan
with 31 assets, 24 generation requests and seven original-image crops. No old
generated result is reused. Plan digest:
`2ce9be879256d70c1fd260b674c39ef2b0c0655e54d7239b5f9f4e4310c67dc9`.
It is awaiting fresh user compute authorization, with no request dispatched.

No new sample delivery ZIP or sample browser acceptance exists yet. All three
samples remain unfinished; no human visual acceptance is claimed. The tony
branch and pre-existing uncommitted work were preserved; nothing was committed.
