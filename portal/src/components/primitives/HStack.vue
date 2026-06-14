<script setup lang="ts">
// Horizontal flex stack — the row counterpart to VStack.
//   <HStack gap="sm" align="center" justify="between"> … </HStack>
// `gap` accepts a spacing token ('xs'…'xxl'), a number (px), or any CSS length.
// `grow` makes it fill its flex parent (and sets min-width:0 so nested
// truncation/scroll behaves).
import { computed } from 'vue'

type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'

const props = defineProps<{
  gap?: number | string
  align?: Align
  justify?: Justify
  wrap?: boolean
  grow?: boolean
  inline?: boolean
}>()

const ALIGN: Record<Align, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline',
}
const JUSTIFY: Record<Justify, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end',
  between: 'space-between', around: 'space-around', evenly: 'space-evenly',
}
const TOKENS = new Set(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'])

function len(v?: number | string): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return `${v}px`
  return TOKENS.has(v) ? `var(--spacing-${v})` : v
}

const style = computed(() => ({
  display: props.inline ? 'inline-flex' : 'flex',
  flexDirection: 'row' as const,
  gap: len(props.gap),
  alignItems: props.align ? ALIGN[props.align] : undefined,
  justifyContent: props.justify ? JUSTIFY[props.justify] : undefined,
  flexWrap: props.wrap ? ('wrap' as const) : undefined,
  flex: props.grow ? '1 1 0%' : undefined,
  minWidth: props.grow ? '0' : undefined,
}))
</script>

<template>
  <div :style="style"><slot /></div>
</template>
