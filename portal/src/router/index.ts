import { createRouter, createWebHistory } from 'vue-router'
import PipelinesPage from '@/pages/PipelinesPage.vue'
import SettingsPage from '@/pages/SettingsPage.vue'
import DefinitionsBrowser from '@/pages/DefinitionsBrowser.vue'
import PipelineSchemaDoc from '@/pages/PipelineSchemaDoc.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL || '/'),
  routes: [
    {
      path: '/',
      name: 'home',
      component: PipelinesPage,
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsPage,
    },
    {
      path: '/pipeline-schema',
      name: 'pipeline-schema',
      component: PipelineSchemaDoc,
      meta: { bare: true },
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
