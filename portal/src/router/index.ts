import { createRouter, createWebHistory } from 'vue-router'
import type { ViewMode } from '@/types'
import PipelinesPage from '@/components/pages/PipelinesPage.vue'
import VscodePage from '@/components/pages/VscodePage.vue'
import BrowserPage from '@/components/pages/BrowserPage.vue'
import SplitPage from '@/components/pages/SplitPage.vue'
import HarnessPage from '@/components/pages/HarnessPage.vue'
import SettingsPage from '@/components/pages/SettingsPage.vue'
import DefinitionsBrowser from '@/components/pages/DefinitionsBrowser.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL || '/'),
  routes: [
    {
      path: '/',
      name: 'home',
      component: PipelinesPage,
    },
    // Each view mode is its own page, but they all compose the shared
    // PipelineWorkspace component for now.
    {
      path: '/:pipelineId/vscode',
      name: 'vscode',
      component: VscodePage,
      meta: { view: 'vscode' as ViewMode },
    },
    {
      path: '/:pipelineId/browser',
      name: 'browser',
      component: BrowserPage,
      meta: { view: 'browser' as ViewMode },
    },
    {
      path: '/:pipelineId/split',
      name: 'split',
      component: SplitPage,
      meta: { view: 'split' as ViewMode },
    },
    {
      path: '/harness/vscode',
      name: 'harness',
      component: HarnessPage,
      meta: { view: 'vscode' as ViewMode, harness: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsPage,
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
      component: DefinitionsBrowser,
    },
    {
      // Catch-all redirect
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export default router
