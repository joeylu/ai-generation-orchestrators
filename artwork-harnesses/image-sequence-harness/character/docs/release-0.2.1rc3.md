# 0.2.1rc3

- Adds explicit `none` / `bottom_center` alignment policy to immutable plans.
- Detects contact anchors from the lowest alpha band, translates whole frames only,
  records every source/output anchor and integer `dx/dy`, and fails on clipping.
- Retains unaligned frames and an unaligned GIF alongside aligned delivery artifacts.
- Adds local `preview-align` before/after GIFs for reviewed transparent raw boards;
  previews do not bypass matte evidence or candidate review for formal delivery.
- Keeps `none` as the compatibility default and adds a regression fixture for the
  multi-row baseline jump.
- Documents action routing: fixed-contact idle/stationary motions may opt in;
  airborne motion stays unaligned, while walk/run requires before/after review.
