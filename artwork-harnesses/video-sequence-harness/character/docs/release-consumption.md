# Immutable release consumption

Production must consume this repository as an immutable upstream release, not as
a copied source directory.

1. CI builds each Harness wheel, source distribution, and thin Skill ZIP from
   its own versioned package directory. Video uses `video-vX.Y.Z` (legacy
   `vX.Y.Z` remains accepted); background removal uses `background-vX.Y.Z`.
2. The release publishes SHA-256 checksums and an SBOM alongside those artifacts.
3. A consumer lock records the version, release URL, and exact artifact digest.
4. Production downloads to a cache, verifies the digest, and installs that
   artifact without editing it.
5. Fixes land upstream, pass public regression tests, receive a new version, and
   are adopted by changing only the consumer lock.

The character-video and image-background-removal Skill ZIPs are created by
`.github/release_tools/build_release_metadata.py --dist dist --component <name>`
after the corresponding Python build. Each includes only its fixed public Skill
allowlist and license, with normalized text and deterministic ZIP metadata. Its
SHA-256 appears in the same `SHA256SUMS.txt` as its wheel. Extra workspace files are never swept
into either archive. An existing archive with different bytes is rejected
rather than overwritten. Older releases without one of these assets remain
unchanged; use their fixed-tag source archive for the corresponding Skill
instead.

Each Harness owns its `pyproject.toml` and `MANIFEST.in`, which include that
Harness's public documentation, thin Skill, and golden test data. The metadata builder
checks these required members in the actual tarball before emitting release
checksums; merely having them in the checkout is insufficient. Linked, escaping,
or duplicate tarball file entries are rejected without extracting the archive.

Do not copy `tools/` into a production runtime package or patch the installed
package in place. A production-only fix is temporary evidence for an upstream
issue, never a second authoritative source.

The two package versions are intentionally independent. A video consumer may
omit the background-removal wheel entirely, use a separately locked local
version, or use an MCP service. It locks `ai_reference_preparation_handoff_v1`
and verifies materialized artifacts instead of importing the producer package.

A consumer that performs its own bounded probe/decode should call the installed
release with `process --decoded-handoff`. Its lock should also record the required
handoff schema version. Private orchestration remains in the consumer; the public
handoff contains no attempt, authorization, transport, endpoint, or host-path
fields.
