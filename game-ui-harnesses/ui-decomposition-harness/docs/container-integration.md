# User-managed container integration

This repository intentionally does not ship a Dockerfile or container runtime.
The Harness can run inside a user-managed OCI container when these conditions are
met:

- Debian/Ubuntu-compatible userspace with Python 3.10 or 3.14. Alpine is not a
  tested target because NumPy and SciPy wheel availability differs.
- Install the package with the `psd` extra when PSD output is required.
- Run as a non-root user.
- Mount references and provider results read-only. Mount the Harness workspace,
  request outbox, and delivery directory as separate writable volumes.
- Do not bake provider credentials into the image, plan, request bundle, logs, or
  output layers. A provider adapter owns its credentials outside the core run.
- Persist the entire workspace and request bundles. An indeterminate provider
  request must remain terminal after container restart.
- Run `ai-ui-decomposition doctor` and `self-test` in the built image before use.

The core CLI needs no GPU and performs no network access. A separate provider
adapter may require network or GPU according to its own explicit policy. The
adapter exchanges only the file bundle described in
[provider-adapter.md](../references/provider-adapter.md).
