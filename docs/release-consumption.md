# Immutable release consumption

Production must consume this repository as an immutable upstream release, not as
a copied source directory.

1. CI builds a wheel and source distribution from a version tag whose value must
   match the package version.
2. The release publishes SHA-256 checksums and an SBOM alongside those artifacts.
3. A consumer lock records the version, release URL, and exact artifact digest.
4. Production downloads to a cache, verifies the digest, and installs that
   artifact without editing it.
5. Fixes land upstream, pass public regression tests, receive a new version, and
   are adopted by changing only the consumer lock.

Do not copy `tools/` into a production runtime package or patch the installed
package in place. A production-only fix is temporary evidence for an upstream
issue, never a second authoritative source.
