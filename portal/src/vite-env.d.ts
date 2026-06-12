/// <reference types="vite/client" />

// SVG icons imported as Vue components via vite-svg-loader (`?component`).
declare module '*.svg?component' {
  import type { FunctionalComponent, SVGAttributes } from 'vue'
  const component: FunctionalComponent<SVGAttributes>
  export default component
}
