import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { defineComponent } from 'vue'

export type ViewMode = 'vscode' | 'browser' | 'split'

// Empty component since App.vue handles all the rendering
const EmptyComponent = defineComponent({
  render: () => null,
})

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL || '/'),
  routes: [
    {
      path: '/',
      name: 'home',
      component: EmptyComponent,
    },
    {
      path: '/:pipelineId/vscode',
      name: 'vscode',
      component: EmptyComponent,
      meta: { view: 'vscode' as ViewMode },
    },
    {
      path: '/:pipelineId/browser',
      name: 'browser',
      component: EmptyComponent,
      meta: { view: 'browser' as ViewMode },
    },
    {
      path: '/:pipelineId/split',
      name: 'split',
      component: EmptyComponent,
      meta: { view: 'split' as ViewMode },
    },
    {
      path: '/harness/vscode',
      name: 'harness',
      component: EmptyComponent,
      meta: { view: 'vscode' as ViewMode, harness: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: EmptyComponent,
    },
    {
      // Sub-state in the path so a refresh stays on the same tab/skill/file:
      //   /definitions                  → default (pipelines)
      //   /definitions/skills           → skills tab
      //   /definitions/skills/:id       → a skill selected
      //   /definitions/skills/:id/:file → a file within the skill
      //   /definitions/pipelines/:id    → a pipeline definition selected
      path: '/definitions/:tab(pipelines|skills)?/:id?/:file?',
      name: 'definitions',
      component: EmptyComponent,
    },
    {
      // Catch-all redirect
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export function getPipelineIdFromRoute(route: RouteLocationNormalized): string | null {
  return (route.params.pipelineId as string) || null
}

export function getViewModeFromRoute(route: RouteLocationNormalized): ViewMode {
  return (route.meta.view as ViewMode) || 'vscode'
}

export function isHarnessRoute(route: RouteLocationNormalized): boolean {
  return route.meta.harness === true
}

export default router
