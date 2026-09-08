# Real MCP recognition acceptance — 2026-09-08

The user supplied a local business key file and authorized the second analysis
after the first model response failed strict compilation. Exactly two vision
submissions were created. Credentials, endpoints and provider task identities
remain in ignored local configuration/state, outside this report and bundles.

The 272×128 purchase reference has source SHA-256
`88def71ade90063639bf0add5dffa758a6dc0a3ef5146a0e88eee6f08beb7b46`.

1. The first response described the purchase button but returned a root ID
   instead of a node object. Strict validation rejected it; nothing was exported.
2. The separately authorized second response identified a Button with an Image
   child and baked label artwork. A transport interruption during `get_task`
   required read-only retrieval of that existing task. No new vision submission
   was made to recover the result.
3. The raw description contained one premature envelope-closing brace before
   `policy`. The recorded deterministic normalization removed that single brace,
   preserved every field/value, then passed strict source-bound compilation and
   bundle validation. Raw result and normalization fingerprints remain local.
4. The resulting bundle was loaded in a fresh browser. A real pointer click
   produced exactly one Button activation. Four comparison canvases mounted,
   Premium was exported by an actual download, and the exported bundle restored
   as Button + Image with Premium motion. These checks made zero model calls.

The comparison screenshot was visually inspected. This proves a real model
result and its deterministic downstream rendering/export, with explicit recovery;
it is **not** an uninterrupted fresh upload-to-export pass of the final adapter.
No third model call was made. New regression tests cover the wire-format defect
and transport read recovery. Live recognition accuracy for the other fifteen
component types is not established by this Button example.

The local service reads server-only settings from ignored `.env.local`. A scan
of built browser files found no key, key-file path or configured provider host.
Offline verification is recorded separately in
[studio MCP verification](studio-mcp-live-verification.json).
