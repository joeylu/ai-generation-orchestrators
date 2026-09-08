# UI component Harness contract

Root repository rules apply. The user approved this local Web acceptance Harness
and incremental implementation of the full UI mainline and separate motion layer.

- Keep v0.1 Button intent, compiler, and interaction behavior compatible.
- Strict intent -> deterministic compiler -> engine-neutral contract -> PixiJS
  adapter -> actual browser acceptance is the public execution chain.
- Node/library contracts must not import DOM or PixiJS. Browser UI may use DOM for
  the workbench; rendered components are PixiJS. Input may use an invisible native
  editing/IME bridge while PixiJS owns the visible component.
- No guessed text, inferred business actions, silent field defaults, placeholder
  recovery, automatic model retries, or stale successful output after errors.
- Explicitly identify procedural fixtures, reviewed user inputs, and unexecuted
  provider/device checks. User artwork stays local unless redistribution is clear.
- Motion is a separate validated document referencing existing component IDs.
- Preserve real errors, guarantee teardown, reject unsafe portable resource paths,
  and validate complete trees and bundles before successful publication.
- Do not publish/deploy or contact a model provider during tests.
- Update docs/tasks.md with executed evidence; code presence is not acceptance.
