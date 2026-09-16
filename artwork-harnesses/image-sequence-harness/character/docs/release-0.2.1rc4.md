# 0.2.1rc4

- Adds explicit `bottom_y` alignment between `none` and `bottom_center`.
- `bottom_y` aligns the detected ground baseline to the selected reference frame
  while preserving every frame's original horizontal placement (`dx = 0`).
- Alignment previews, retained source frames, candidate validation and delivery
  auditing apply equally to `bottom_y` and `bottom_center`.
- Keeps `none` unchanged for intentional airborne motion.
