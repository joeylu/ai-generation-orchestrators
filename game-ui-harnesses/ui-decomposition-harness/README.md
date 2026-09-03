# UI decomposition harness

**Status: implemented as an opt-in experimental Harness. It is not a default
route. Its unattended route has an automatic visual-quality gate, but that gate is
not a human reviewer.**

This package turns a UI decomposition plan plus locally materialized component
images into a layered PSD. The development headless entry can also obtain a plan
and images through a configured optional provider. It keeps only important editable or reusable
components, removes ordinary raster text by policy, reuses repeated component
families, preserves aspect ratio during reuse by default, and requires a
digest-bound visual review for reviewed delivery. The unattended route runs a
bounded model-based visual-quality gate before it can export an unreviewed draft;
its deployment-selected strict or advisory result never claims human acceptance.
Empty stretchable bases can explicitly
opt into nine-slice resizing with selected corner insets; see the plan contract.

Deterministic processing commands remain offline. Only explicit `auto-run` may
invoke the configured provider; it never retries generation, controls Photoshop,
or modifies another Harness. `auto` currently selects PSD; explicit PSB requests are
rejected because PSB has not been validated.

The `0.3.0` release includes the headless entry and its mandatory automated
visual-quality gate alongside the reviewed flow. It adds conservative local
resource preflight and streaming raster staging. It remains opt-in because the
gate does not imply human acceptance or perfect visual reconstruction.
See [headless integration](docs/headless.md) for its contract and verification limits.

## Production consumption: verified Release wheel

Use a fixed GitHub Release tag such as `ui-v0.3.0`; do not install a Git ref or
a source checkout as a production dependency. From that one Release, obtain its
wheel and `SHA256SUMS.txt`. The wheel's SHA-256 is only evidence for that wheel:
the deployment must separately maintain a fully hash-locked dependency set for
the base runtime and the `psd` extra (including transitive dependencies).

The PowerShell example below queries the public metadata of the selected fixed
Release to obtain the wheel's exact asset byte count, then downloads only the
wheel and checksum file associated with that Release. It does not contain a
precomputed future checksum or byte count. On POSIX systems, perform the same
checks with the Release asset `size`, `sha256sum`, and `wc -c`; use an isolated
virtual environment after both comparisons succeed.

```powershell
$ReleaseTag = "ui-v0.3.0"
$Wheel = "ai_ui_decomposition-0.3.0-py3-none-any.whl"
$Release = Invoke-RestMethod "https://api.github.com/repos/joeylu/ai-generation-orchestrators/releases/tags/$ReleaseTag"
$WheelAsset = @($Release.assets | Where-Object { $_.name -eq $Wheel })
$SumsAsset = @($Release.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" })
if ($WheelAsset.Count -ne 1 -or $SumsAsset.Count -ne 1 -or [int64]$WheelAsset[0].size -le 0) {
    throw "The selected Release does not contain one non-empty wheel and SHA256SUMS.txt. Stop."
}
Invoke-WebRequest -Uri $WheelAsset[0].browser_download_url -OutFile $Wheel
Invoke-WebRequest -Uri $SumsAsset[0].browser_download_url -OutFile "SHA256SUMS.txt"

$MatchingLines = @(Get-Content -LiteralPath "SHA256SUMS.txt" | Where-Object {
    $_ -match "^(?<sha>[a-f0-9]{64})  $([regex]::Escape($Wheel))$"
})
if ($MatchingLines.Count -ne 1) { throw "The wheel filename has no unique SHA-256 entry. Stop." }
$ExpectedSha = ([regex]::Match($MatchingLines[0], "^(?<sha>[a-f0-9]{64})  ")).Groups["sha"].Value
$ActualBytes = (Get-Item -LiteralPath $Wheel).Length
$ActualSha = (Get-FileHash -LiteralPath $Wheel -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualBytes -ne [int64]$WheelAsset[0].size -or $ActualSha -ne $ExpectedSha) {
    throw "Release wheel byte count or SHA-256 mismatch. Stop; do not install it."
}

python -m venv .venv
.venv\Scripts\python.exe -m pip install --require-hashes -r deployment-requirements.lock
.venv\Scripts\python.exe -m pip install --no-deps $Wheel
.venv\Scripts\ai-ui-decomposition.exe doctor
.venv\Scripts\ai-ui-decomposition.exe self-test
```

`deployment-requirements.lock` belongs to the deployment. Before the
`--no-deps` wheel install, it must supply every pinned and hashed base and PSD
dependency required by the selected release. Do not treat `SHA256SUMS.txt` as
a lock for those recursive dependencies.

## Developer and contributor source checkout

The [quickstart](docs/quickstart.md) starts from a source checkout and uses a
source install for development or contribution work. It is not a production
consumption path and cannot replace the Release wheel byte-count and digest
verification above.

The complete local flow is in the
[quickstart](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/docs/quickstart.md).
Read the
[Skill](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/SKILL.md),
[plan contract](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/references/contract.md),
and [provider file protocol](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/references/provider-adapter.md)
before integrating an Agent or external image provider. Container requirements
are documented without adding an official Docker image.

For a service integrator, the [integration handoff](docs/container-integration.md#integration-handoff-boundary)
separates the processing library and optional provider from the receiving
application's web UI and deployment. No web server or Docker image is included.
