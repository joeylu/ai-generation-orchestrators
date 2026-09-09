# Twenty-image semantic intent baseline

Executed on 2026-09-08 against checkpoint `947708a`, without changing the
production instruction, adapter or compiler. Twenty generated reference images
cover all sixteen component types, including four composite/confusion cases.
An Agent inspected the actual images and froze expected types before recognition;
expectations and generation prompts were not sent to the vision service.

Exactly twenty vision jobs were submitted. Further reads used existing task IDs;
there were no repeated business submissions. All twenty reached terminal states.
One oversized generated Panel variant was replaced before recognition, so the
evaluated twenty images all met the existing two-MiB source limit.

| Gate or outcome | Samples |
| --- | ---: |
| Valid JSON and response envelope | 7/20 |
| Strict intent compilation | 6/20 |
| Compilation plus expected visible component semantics | 2/20 |
| Invalid JSON | 12/20 |
| Contract failure | 1/20 |
| Compiled but lost expected semantics through whole-image fallback | 4/20 |
| Provider task failure without an inspectable result | 1/20 |

Select and decorative Image passed semantic checks. ProgressBar, Text,
Container and Panel references returned only Image nodes. The Button output
omitted required `children`. The CheckBox raw description also incorrectly used
Button, but its invalid JSON is the primary recorded failure. The RadioGroup
task failed at the provider; this is not a classification result. Remaining
samples failed JSON parsing, including the four composite cases.

This establishes a weak cross-sample baseline, not repeatability statistics:
each image received one recognition attempt. The synthetic set is small and
Agent-reviewed. Hidden runtime properties, visual fidelity and browser interaction
were not accepted by this evaluation. The configured service's internal model
version was not established. Source artwork, immutable request/output records,
raw model descriptions and the detailed local delivery are kept outside the
public package. No secret, endpoint or private task identifier is included here.

Future work should strengthen structured response constraints and add semantic
checks against whole-image fallback, while separating observable intent from
unobservable runtime requirements. Use an additional held-out set when changing
the prompt; passing this same set after tuning is not independent acceptance.
