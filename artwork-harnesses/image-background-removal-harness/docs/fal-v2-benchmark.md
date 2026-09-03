# fal.ai BiRefNet V2 hard-sample benchmark

This is a frozen, seen diagnostic corpus from 2026-09-04. The ten source images
are private and are not distributed. There is no pixel alpha ground truth, so
the results are manual visual classifications rather than statistical accuracy.
All outputs passed deterministic structure, path, checksum, and alpha validation.

## Single-profile results

| Profile | Strict visual pass | Conditional | Fail | Main observed limitation |
| --- | ---: | ---: | ---: | --- |
| General Light 1024 | 5/10 | 2/10 | 3/10 | Missed a detached prop and could not separate background already composited through translucent material. |
| General Light 2K 2048 | 5/10 | 0 | 5/10 | Higher resolution sometimes retained substantially more background. |
| General Heavy 2048 | 4/10 | 0 | 6/10 | Restored one missed prop but introduced severe subject holes or detached-background false positives elsewhere. |
| Matting 2048 | 5/10 | 0 | 5/10 | Eroded legitimate translucent details and still could not undo composited background texture. |

No tested profile was a strict upgrade over General Light 1024. It therefore
remains the single-model default. Heavy, Light 2K, Matting, and Dynamic are never
silent fallbacks.

The General Light 1024 strict passes were cases 006, 016, 053, 065, and 093.
Cases 033 and 043 were conditional because a smoke effect was removed and a
source-edge train was already cropped. Cases 003, 023, and 036 failed because of
retained background through translucent material or an omitted lantern.
Case 065 specifically covered a bat-like subject with four intentional enclosed
transparent holes; those holes were preserved.

Dynamic 2304 was also tried once on failures 003, 023, and 036. It fixed none of
them and weakened some soft detail. This is evidence against using Dynamic as an
automatic fallback, not a general model-quality ranking.

## Experimental consensus result

The source-coordinate alpha gate compares General Light 1024 with Light 2K and
Matting. It accepts the fixed General Light 1024 result only when Light 2K IoU is
at least 0.95 and Matting IoU is at least 0.80.

On these ten seen samples it accepted 006, 016, 053, 065, and 093, and rejected
003, 023, 033, 036, and 043. It admitted none of the known strict failures in
this small corpus.

That result does not establish an unseen pass rate. In case 023, several models
agreed on a semantically wrong mask containing clouds inside a translucent body.
In case 036, Light 1024, Light 2K, and Matting all omitted the lantern, while only
Heavy restored it. Agreement is therefore a conservative rejection signal, not
a correctness certificate or winner selector.

## Timing and cost boundary

Observed local wall time varied with provider queue conditions and is not
billable compute time. The benchmark does not claim that one profile is cheaper
than another. A consuming service must use provider-returned billing evidence or
the provider's current pricing terms and must not infer cost from these timings.

## Release interpretation

This benchmark supports the default choice and documents known failure classes.
It does not replace visual or semantic QA, does not authorize additional provider
calls, and does not turn a structurally valid preparation into an automatically
approved foreground. Private source images, provider transport responses, and
credentials are intentionally excluded.
