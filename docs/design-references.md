# Design and motion references

Saved for inspiration and implementation guidance (animations, JavaScript effects, layouts, interactions). Learn the
patterns; don't copy designs, branding or code without checking each project's licence.

| Name | Address | Use it for |
|---|---|---|
| Anime.js | https://animejs.com | Timeline and stagger animations, SVG path drawing and morphing, spring easings. Good for sticker pops, staggered card entrances, drawn underlines. |
| Motion | https://motion.dev | Spring physics, gestures (drag, hover, press), scroll-linked and layout animations; the vanilla `animate()` API works without React. Reference for natural-feeling springs and layout transitions. |
| Kokonut UI | https://kokonutui.com | Copy-paste React/Tailwind components (shadcn registry, e.g. `@kokonutui/ai-checkout` for AI chat apps). Use for patterns and interaction ideas; the dashboard has no React build, so components are not installed directly. |
| Bklit UI | *to confirm* (given as "bklit.ui"; possibly ui.bklit.com) | UI components and patterns. The exact address could not be checked from this environment. |
| Vercel OSS | https://vercel.com/oss | Open-source projects Vercel supports: a list to find well-kept UI, animation and tooling libraries. |
| v0 | https://v0.app | Generating and exploring layouts and components quickly; useful for trying a section's structure before building it. |

## How the dashboard uses them today

- Animations are written with the browser's built-in Web Animations API and CSS keyframes (the same model Motion's
  `animate()` uses), so nothing extra has to load: card entrances, sticker wiggles and pops, the save sparkle and the
  floating background shapes in Notes.
- Every animation stops for people who turn on "reduce motion" in their system settings.
- Motion 11.11.17 and Anime.js 3.2.2 are loaded from cdn.jsdelivr.net (pinned versions, the page has no npm build, so
  `npm install motion` / `npm i animejs` are replaced by these script tags). Notes uses Motion springs for card
  entrances and button presses, and Anime.js to draw sketches on. If either fails to load, the browser's own animation
  is used. `npx motion-ai` (AI coding rules for Motion projects) has no project to set up here.
