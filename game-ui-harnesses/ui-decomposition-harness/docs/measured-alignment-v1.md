# Align independent assets to an accepted generated surface

`ai-ui-assets align-materials --run-dir RUN --specification SPEC --output FRESH`
creates an all-import PNG plan and alignment evidence. It never generates,
resamples, authorizes, or grants visual acceptance. Use after the user accepts
the generated surface and requests adapting independent artwork to it.

SPEC has exact fields: kind=`ui_assets_measured_alignment_v1`, planDigest,
materialsDigest, nonempty basis, alignments. Each alignment contains node,
surfaceNode, row=[x,y,width,height] in canvas coordinates, visibleLeft in canvas
coordinates. Caller-reviewed row measurements remain necessary; no automatic
semantic detection is implemented. Source hashes bind both icons and surfaces.

The command centers the visible Alpha bounding box vertically and aligns its left
edge, rounds to integer placement, rejects overflowing geometry, duplicate nodes,
moving reference surfaces, changed digests and existing output directories.
All materials are copied byte-for-byte. Continue through ordinary freeze, process,
draft finalize, composite review and export. Zero generated assets need no compute
authorization. The plan uses the verified normalized reference snapshot; retain
the original artwork in the source job and accompanying delivery evidence.

Reference coverage remains an inventory of source observations, not proof of new
placement equivalence. Record adaptation explicitly; do not report original
reference registration or automatically change a prior visual rejection to pass.
