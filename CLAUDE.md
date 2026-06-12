# Bender

Docker-based pipeline orchestration/visualization platform for running rancher/dashboard issue-fix pipelines.

## Frontend conventions (portal/)

### Don't inline SVGs

Do **not** write inline `<svg>…</svg>` markup in `.vue` components. Each icon is a
single SVG definition that belongs in `portal/src/assets/icons/<name>.svg` and is
imported as a Vue component via vite-svg-loader:

```ts
import EditIcon from '@/assets/icons/edit.svg?component'
```
```html
<EditIcon width="15" height="15" />   <!-- or size via CSS: .icon-btn svg { width: … } -->
```

- The `.svg` file holds only the drawing: `viewBox` + paths/lines, with
  `stroke="currentColor"` / `fill="currentColor"` so the icon inherits theme color.
- Size at the call site (a `width`/`height` attr, or a parent CSS rule like
  `.bottom-icon-btn svg { width: 16px }`) — keep size out of the `.svg`.
- vite-svg-loader is configured with `svgo: false` in `vite.config.ts` so
  hand-authored icons are preserved verbatim; the `*.svg?component` module is
  declared in `src/vite-env.d.ts`.

The only allowed inline `<svg>` are **non-icon** SVGs with reactive bindings or
component-scoped animation that can't live in a static file (e.g. the
`PipelineGraph` edge canvas, the `running-ring` marquee). Reusable UI lives in
`portal/src/components/primitives/`.
