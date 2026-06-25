import { computed, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'

// Small composables that read the current route, so components don't have to
// reach for useRoute() and the params/meta plumbing themselves. Each returns a
// reactive computed that tracks route changes.

/** The pipeline id from the current route, or null (home, settings, …). */
export function usePipelineId(): ComputedRef<string | null> {
  const route = useRoute()
  return computed(() => (route.params.pipelineId as string) || null)
}
