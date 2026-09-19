# Verified historical request replay

For controlled PNG experiments, a generated asset may declare
`historical_request` as the original received request digest. Freeze with
`ai-ui-assets freeze --plan PLAN --workspace WORKSPACE --run NEW --replay-from ORIGINAL_RUN`.
Use a fresh plan/run; never edit old requests. Read the digest from the original
verified request rather than inventing a provenance marker.

Freeze verifies the original received result and its quality evidence, original
reference identity, role, route, source region, output size, output mode and asset
description. It reuses the actual request prompt without current prompt additions,
then verifies normalized reference and crop hashes exactly match original inputs.
The binding is part of the new plan digest. Cached or recovered originals cannot
serve as sources; new generated assets cannot combine cache and replay bindings.
Unbound assets use ordinary current compilation. One source run per freeze.

This creates prepared requests only. Fresh authorization, coverage checks,
generation, material quality and visual review remain required. No original output
is imported and no original authorization is reused. Frozen input equivalence does
not prove historical tool forwarding, model version, random seed or output equality.
New prompts should not use this opt-in diagnostic route to claim current prompt
policy compliance. It deliberately preserves historical wording.
