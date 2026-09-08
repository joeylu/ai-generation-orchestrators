# Design references

Reviewed on 2026-09-08. These are external design/API references; this package
does not install them or require their runtimes. The local recipes and strict
compiler are independently authored for the Harness contract.

- [LottieFiles Motion Design Skill](https://github.com/LottieFiles/motion-design-skill):
  motion personality, feedback and choreography as design inputs.
  [State/feedback recipes](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/patterns/state-feedback.md)
  supply the three Button press/release timing/scale starting cases. Playful uses
  0.95/60ms, then 1.05/80ms, then 1/120ms spring; Premium uses 0.98/80ms then
  1/150ms; Corporate uses 0.97/60ms then 1/100ms. The Harness fixes Corporate's
  optional overshoot at zero. All other component mappings, hover/entry/focus/
  change/stagger/scroll tokens, compiler and runtime are Harness-authored
  extensions. This is not a claim that LottieFiles supplied 48 component recipes.
  Success/error cases still need an explicit business outcome from the host.
- [GSAP skills](https://github.com/greensock/gsap-skills), especially
  [timeline examples](https://github.com/greensock/gsap-skills/blob/main/skills/gsap-timeline/SKILL.md):
  explicit sequencing, parallel placement and nested reusable clips. This package
  continues to use its own deterministic sampler, not GSAP's clock or easing names.
- [PixiJS skills](https://github.com/pixijs/pixijs-skills):
  v8 event, container, ticker and lifecycle guidance for the implemented adapter.
- [web-animation-design in Vercel open-agents](https://github.com/vercel-labs/open-agents/blob/main/.agents/skills/web-animation-design/SKILL.md):
  interaction responsiveness, transform origins and interruptibility references.
  DOM/CSS-specific advice is not automatically a Canvas implementation rule.

Treat style/timing advice as contextual, not universal truth. Sources differ on
exit easing and amount of bounce. User/project choices and verified capabilities
determine the final recipe; browser tests and visual review establish acceptance.
