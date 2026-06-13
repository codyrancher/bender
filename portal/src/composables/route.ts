import { computed, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import type { ViewMode } from '@/types'

// Small composables that read the current route, so components don't have to
// reach for useRoute() and the params/meta plumbing themselves. Each returns a
// reactive computed that tracks route changes.

/** The pipeline id from the current route, or null (home, settings, harness, …). */
export function usePipelineId(): ComputedRef<string | null> {
  const route = useRoute()
  return computed(() => (route.params.pipelineId as string) || null)
}

/** The active view mode (vscode | browser | split), defaulting to vscode. */
export function useViewMode(): ComputedRef<ViewMode> {
  const route = useRoute()
  return computed(() => (route.meta.view as ViewMode) || 'vscode')
}

/** Whether the current route is the global harness (no pipeline). */
export function useIsHarness(): ComputedRef<boolean> {
  const route = useRoute()
  return computed(() => route.meta.harness === true)
}
