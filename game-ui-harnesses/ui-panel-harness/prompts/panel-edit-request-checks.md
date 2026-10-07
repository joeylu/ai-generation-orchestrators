# Explicit request checks

Context 0.11 includes program-owned `requestChecks`. The `items` are whole,
unambiguous geometry clauses from the exact request, each with literal offsets,
field and expected value. Every item must match the resulting authored Spec.
The gate reads the result, even if you omit an operation, quote the whole request,
or claim no change. Already satisfied values need no redundant operation.
`height` and `ratio` require a fixed frame; `width` reads layout.width. Other
geometry fields read the corresponding layout field. Ratio uses cross-products.

Apply all requested changes atomically. If they conflict, cannot fit, or require
clarification, return null patch with precise unresolved questions. Never silently
apply just the easy part. Items are a bounded independent check, not the entire
request: interpret unverified clauses too, and do not claim they passed semantic
review. The grammar deliberately excludes relative requests, quoted examples,
corrections, duplicate assignments and selected-row requests. Do not amend the
context or echo requestChecks as a new draft/proposal field.
