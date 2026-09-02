# Example workflow

Run `ai-ui-decomposition init` against your own reference to create a valid,
digest-bound starter plan. Then add the important assets, nodes, and groups using
the example in [the plan contract](../references/contract.md).

A checked-in plan cannot be directly runnable because its source SHA-256 must
bind the user's actual reference file. For that reason this directory does not
ship a fake digest or pretend that a placeholder plan has passed preflight.
