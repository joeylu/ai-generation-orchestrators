# Incremental verification

Keep sample production, reusable code changes and their verification distinct.
An unchanged, previously checked artifact can be used as input only after its
content identity and relevant evidence are checked again. A path or modification
time alone is not an identity. Preserve failed results, reservations and review
decisions; do not spend or transfer an old authorization to a new plan.

Choose checks by the affected contract. A local diagnostic change needs its
own synthetic boundary tests; changes to topology or coverage also need the
relevant combination matrix and a separate actual Studio review. Changes to
generation, reception, packaging or validation need the corresponding integrity
and replay checks. Existing tests and case evidence remain historical records,
not claims that a new version reran them.

The bottom-edge delivery's checked base now reads each proof artifact once per
base check, while still scanning the full inventory and checking its sealed
manifest, byte length and SHA-256. This is not a persistent cache or derivation
replay: delivery verification continues to perform its existing independent
rebuild and checks. Time saved depends on file count, storage and other work;
no whole-pipeline speedup is implied.

Terrain-edge exchange inspection, reservation preflight and receipt input
checking use a fresh locked workflow view for each operation. The view verifies
the relevant batch and input artifacts in one replay; reservation, submission
and result receipt remain separate durable transitions and independently check
their state. Receipt and terminal-unknown handling read only the reserved
plan's immutable inputs, even if its source later becomes stale. This is neither
a persistent cache nor permission to resubmit a request. In one read-only
comparison on the timed sample's existing batch,
inspection returned identical data in 9.7 seconds versus 18.5 seconds for the
previous two-replay sequence. A separate one-sample read-only reservation
preflight comparison returned the same batch, plan, event count and input bytes
in 5.9 seconds versus 30.7 seconds for the prior sequence. Neither comparison
submitted a request. These single observations do not establish an end-to-end
speedup or an expectation for other machines.

The terrain-edge exchange reserves its selected batch member in the same locked
transaction that checks the batch for stopped or active attempts. It binds the
selection observed during preflight: if another operation has advanced the
batch, it stops before writing a reservation. The older generic `reservePlan`
entry point remains plan-scoped; this batch single-active guarantee applies to
the terrain-edge exchange and its batch-scoped reservation entry point.

Cross-project coherent rebind submission independently replays the selected
source, then replays the target once under its commit lock to recompile and
compare the exact proposal before checking the parent and writing records.
The read-only proposal operation still performs its own fresh source and target
replays. No cross-operation cache or cross-workflow atomic snapshot is implied.
In three alternating synthetic read-only comparisons, the previous proposal plus
target replay took 270.5–283.2 ms and the combined target replay took
204.7–223.6 ms; proposal and journal-head evidence matched. This does not measure
the full commit, real sample, model calls or end-to-end production.
