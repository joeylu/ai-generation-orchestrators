# 0.2.1rc5

- Adds an optional, immutable 16-entry `pose_blueprint` compiled into the board
  generation prompt.
- Adds optional 16-entry positive `timing_weights` for deterministic non-uniform
  frame timing while preserving total duration.
- Candidate records bind the timing policy and exact rational frame starts and
  durations; GIF validation uses the same policy.
- Omitting both fields preserves the existing four-phase and equal-timing behavior.
