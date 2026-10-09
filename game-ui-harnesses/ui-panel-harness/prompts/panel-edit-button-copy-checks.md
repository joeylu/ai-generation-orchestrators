# Exact button copy checks

Context 0.13 extends explicit-properties-v2 with program-owned exact button copy
requirements. A buttonLabel item names a stable row ID in the base document, not
a label to search again after renaming. Apply set-button-label to that ID and keep
the complete expected text, including negation, whitespace, punctuation and emoji.
Do not translate, shorten, trim, remove the button or rename a different button.
Existing Spec and component text contracts still apply. If the exact requested
copy cannot compile (including leading/trailing spaces), ask for clarification;
never silently normalize it to make it compile.

Each explicitly named button must satisfy its own final value. A false noChange
claim, an omitted item or a whole-request quotation cannot bypass this check.
Values already satisfied require no extra operation. Preserve existing actions,
reset/submit scopes, recipes, bindings and assets. If preserveRest.enforced is true,
only the declared properties may change; an unrelated style or action change
rejects the whole patch. Current player values follow the existing preserve policy.

The grammar is bounded to complete copy assignments with quoted new text and a
unique current button name or a program-owned selected pronoun. Duplicate names,
corrections, examples and other unverified prose still need interpretation or
clarification. Unverified clauses do not grant automatic scope approval. Never
amend requestChecks or claim that all natural language has been semantically checked.
