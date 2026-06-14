<script setup lang="ts">
// Vertical flex stack. Compose layouts without hand-rolling flex CSS each time.
//   <VStack gap="md" align="center"> … </VStack>
// `gap` accepts a spacing token ('xs'…'xxl'), a number (px), or any CSS length.
// `grow` makes it fill its flex parent (and sets min-height:0 so nested
// scrollers behave). See HStack for the horizontal counterpart.
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
  flexDirection: 'column' as const,
  gap: len(props.gap),
  alignItems: props.align ? ALIGN[props.align] : undefined,
  justifyContent: props.justify ? JUSTIFY[props.justify] : undefined,
  flexWrap: props.wrap ? ('wrap' as const) : undefined,
  flex: props.grow ? '1 1 0%' : undefined,
  minHeight: props.grow ? '0' : undefined,
}))
</script>

<template>
  <div :style="style"><slot /></div>
</template>
