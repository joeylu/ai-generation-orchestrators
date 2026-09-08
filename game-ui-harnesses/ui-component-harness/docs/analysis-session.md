# Analysis session ledger v0.1

`src/analysis-session.ts` records a caller-provided classification of a UI
source. It is deliberately a provider-free, engine-neutral boundary: it makes
no network request, opens no source file, selects no model, and has no fallback
or canned analysis result.

The ledger binds each analysis result to an exact portable source reference and
a lowercase SHA-256 digest. It is useful when an application or a human has
already performed a review and needs to preserve the result, provenance, and a
small retry budget without treating that review as renderable UI.

```ts
import { analysisReport, createAnalysisSession, recordAnalysis } from './src/analysis-session.ts';

const source = {
  reference: 'assets/quest-panel.png',
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

let ledger = createAnalysisSession({
  analysisVersion: '0.1', id: 'quest-panel-review', source, attemptBudget: 2,
});

ledger = recordAnalysis(ledger, {
  source,
  result: {
    status: 'Composite',
    summary: 'The source shows a panel containing a button and progress bar.',
    componentTypes: ['Panel', 'Button', 'ProgressBar'],
  },
});

console.log(analysisReport(ledger).status); // Composite
```

## States and retry ledger

`analysisReport()` derives one of these states from a validated ledger:

| State | Meaning | May record another analysis? |
| --- | --- | --- |
| `NOT_RUN` | No caller result has been recorded. | Initial analysis only, if budget remains. |
| `Supported` | Caller classified the source as one built-in component type. | No. |
| `Composite` | Caller classified the source as two or more built-in component types. | No. |
| `Unresolved` | Caller could not determine a supported result. | Yes, while the explicit budget remains. |
| `Custom-required` | Caller determined that a new renderer would be required. | No. |
| `FAILED` | The caller's analysis operation failed. | No. |

The initial ledger has no attempt records and reports `NOT_RUN`. Every record
contains its sequential attempt number, the exact same `{reference, sha256}`
source binding, and the validated result. A persisted ledger is rejected if an
attempt changes the source, exceeds `attemptBudget` (1 through 32), skips a
number, or follows any state other than `Unresolved`.

`recordAnalysis()` accepts only a supplied record. It cannot silently replace
`Unresolved`, `Custom-required`, or `FAILED` with a supported result. It clones
both inputs and outputs, so callers cannot mutate an accepted attempt after the
fact.

## This is not a renderer

`Supported` and `Composite` are classifications, not `TreeIntent` values. A
ledger result contains neither a root node nor layout, props, visual style,
resource facts, or a custom node escape hatch. It cannot be passed to
`compileTree()` or the runtime. A caller that wants to render must separately
author a strict v0.2 `TreeIntent`, provide the explicit `TreePolicy`, and pass
the normal compiler validation. `Custom-required` remains non-renderable.

The online vision-provider task remains **BLOCKED**: no provider, model,
credentials, or authorization has been selected. This module does not change
that status or claim that an analysis has occurred.
