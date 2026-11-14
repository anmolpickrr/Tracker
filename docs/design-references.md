# Design and motion references

Saved for inspiration and implementation guidance (animations, JavaScript effects, layouts, interactions). Learn the
patterns; don't copy designs, branding or code without checking each project's licence.

| Name | Address | Use it for |
|---|---|---|
| Anime.js | https://animejs.com | Timeline and stagger animations, SVG path drawing and morphing, spring easings. Good for sticker pops, staggered card entrances, drawn underlines. |
| Motion | https://motion.dev | Spring physics, gestures (drag, hover, press), scroll-linked and layout animations; the vanilla `animate()` API works without React. Reference for natural-feeling springs and layout transitions. |
| Coconut UI | *to confirm* (given as "coconut.ui") | UI components and visual style. The exact address could not be checked from this environment. |
| Bklit UI | *to confirm* (given as "bklit.ui"; possibly ui.bklit.com) | UI components and patterns. The exact address could not be checked from this environment. |
| v0 | https://v0.app | Generating and exploring layouts and components quickly; useful for trying a section's structure before building it. |

## How the dashboard uses them today

- Animations are written with the browser's built-in Web Animations API and CSS keyframes (the same model Motion's
  `animate()` uses), so nothing extra has to load: card entrances, sticker wiggles and pops, the save sparkle and the
  floating background shapes in Notes.
- Every animation stops for people who turn on "reduce motion" in their system settings.
- If a future feature needs timelines or physics beyond that, add Anime.js or Motion from cdn.jsdelivr.net (already
  allowed by the page's security policy) with a pinned version.
