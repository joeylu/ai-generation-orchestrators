# Local MiniMax H3 provider

The optional MiniMax H3 adapter connects to a user-managed ComfyUI instance on
loopback. The project does not install models, choose a ComfyUI distribution, or
start and stop that process. This prevents the CLI from accidentally launching a
different installation that happens to use the same port.

## Keep an installation inventory

Install ComfyUI and its models in a location chosen by the user, outside this
source repository. Record the local facts in the workspace's ignored private
note:

```text
my-animation/.ai-frame-animation/local-provider-notes.md
```

Start from [`local-provider-notes.example.md`](../examples/local-provider-notes.example.md).
Record the installation root, approved launch command, expected port, workflow
export source, custom-node versions, model filenames, model provenance, and
SHA-256 values. This note is for the operator; the CLI never reads it and
`doctor` never prints it. Do not commit it.

The executable provider configuration remains:

```text
my-animation/.ai-frame-animation/provider.minimax-h3.json
my-animation/.ai-frame-animation/workflow.json
```

`workflow_path` may be relative to the provider configuration file. Keep actual
host paths out of public examples, plans, logs, and issue reports.

## Start the intended runtime explicitly

1. Use the launch command recorded in the private note.
2. Confirm that it listens on the loopback URL in the provider configuration.
3. Export the intended graph in ComfyUI API format to the private workflow file.
4. Bind the reference-image, positive-prompt, generation width/height, and
   reference-resize width/height inputs. Configure one square canvas (512x512
   is the public default example); both nodes are overwritten from that single
   value before submission.
5. Run static `doctor --plan ... --require-ready` before asking for compute
   confirmation. `doctor` deliberately performs no network request.

`plan --provider-config ...` records the square canvas plus SHA-256 values for
the workflow and semantic binding map. It does not record the endpoint or local
workflow path. After the user gives a fresh plan-digest confirmation, `run`
rejects any workflow, binding, or canvas drift before upload, then performs a read-only
live compatibility gate before sending any image or `/prompt`: it requests
`/system_stats` and `/object_info`, checks that every workflow node class exists,
and checks known loader selections against the runtime's advertised model lists.
If the wrong ComfyUI instance, custom nodes, or models are present, the attempt
ends as not submitted. No upload or generation request is made, and the error
does not expose node names or local paths.

This gate establishes runtime compatibility, not visual quality. A successful
gate still permits exactly one plan-bound `/prompt` submission and never enables
automatic generation retry.
