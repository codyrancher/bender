import { watch, nextTick, type Ref } from 'vue'

// Keep a scrollable element pinned to the bottom as content streams in. Declare
// the container ref in the component (so it binds as a template ref) and pass it
// here along with a getter for what changes (e.g. a log string, or
// `() => lines.length`) to trigger the re-scroll.
export function useScrollToBottom(el: Ref<HTMLElement | null>, source: () => unknown): void {
  watch(source, () => {
    nextTick(() => {
      const e = el.value
      if (e) e.scrollTop = e.scrollHeight
    })
  })
}
