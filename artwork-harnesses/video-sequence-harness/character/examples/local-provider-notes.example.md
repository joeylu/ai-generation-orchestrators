# Private local provider notes

Copy this file to `.ai-frame-animation/local-provider-notes.md` inside the user
workspace. Replace every placeholder locally and never commit the result.

- ComfyUI installation root: `<absolute-local-directory>`
- Approved launch command: `<local-command>`
- Expected loopback URL: `http://127.0.0.1:<port>`
- Workflow export source/version: `<description>`
- Custom nodes and locked revisions: `<inventory>`
- Model filenames: `<inventory>`
- Model sources/licenses: `<inventory>`
- Model SHA-256 values: `<inventory>`
- Last operator verification date: `<YYYY-MM-DD>`

The animation CLI does not read this note or start this runtime. Its executable
configuration stays in `provider.minimax-h3.json` and `workflow.json`.
