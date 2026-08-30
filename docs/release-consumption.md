# Immutable release consumption

Production must consume this repository as an immutable upstream release, not as
a copied source directory.

1. CI builds a wheel, source distribution, and thin Skill ZIP from a version tag
   whose value must match the package and Skill versions.
2. The release publishes SHA-256 checksums and an SBOM alongside those artifacts.
3. A consumer lock records the version, release URL, and exact artifact digest.
4. Production downloads to a cache, verifies the digest, and installs that
   artifact without editing it.
5. Fixes land upstream, pass public regression tests, receive a new version, and
   are adopted by changing only the consumer lock.

The Skill ZIP is created by `scripts/build_release_metadata.py --dist dist`
after the Python build. It includes only the fixed public Skill allowlist and
the project license, with normalized text and deterministic ZIP metadata. Its
SHA-256 appears in the same `SHA256SUMS.txt` as the wheel. Extra workspace files
are never swept into the Skill archive. An existing archive with different
bytes is rejected rather than overwritten. Older releases without this asset
remain unchanged; use their fixed-tag source archive for the Skill instead.

`MANIFEST.in` also includes public documentation, the thin Skill, release tooling,
and golden test data in the Python source distribution. The metadata builder
checks these required members in the actual tarball before emitting release
checksums; merely having them in the checkout is insufficient. Linked, escaping,
or duplicate tarball file entries are rejected without extracting the archive.

Do not copy `tools/` into a production runtime package or patch the installed
package in place. A production-only fix is temporary evidence for an upstream
issue, never a second authoritative source.

A consumer that performs its own bounded probe/decode should call the installed
release with `process --decoded-handoff`. Its lock should also record the required
handoff schema version. Private orchestration remains in the consumer; the public
handoff contains no attempt, authorization, transport, endpoint, or host-path
fields.
