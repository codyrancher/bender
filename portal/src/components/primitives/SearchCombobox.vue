<script setup lang="ts">
// A free-text input with a filtered dropdown of suggestions. Typing both sets
// the value (free-form) and filters the list; picking an option sets the value.
// v-model is the string value; emits `submit` on Enter.
//
// The dropdown is teleported to <body> and positioned `fixed` under the input,
// so it floats above (and overflows) any clipping/scrolling ancestor such as a
// modal — the menu never forces the container to scroll.
import { ref, computed, onUnmounted, nextTick } from 'vue'

const props = defineProps<{
  modelValue: string
  options: string[]
  placeholder?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'submit'): void
}>()

const search = ref('')
const show = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const filtered = computed(() => {
  const s = search.value.toLowerCase()
  if (!s) return props.options
  return props.options.filter((o) => o.toLowerCase().includes(s))
})

function updatePosition() {
  const el = inputEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  menuStyle.value = {
    position: 'fixed',
    top: `${r.bottom}px`,
    left: `${r.left}px`,
    width: `${r.width}px`,
  }
}

function open() {
  show.value = true
  updatePosition()
  // Track scroll (capture: catches scrolling inside the modal too) and resize.
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
  nextTick(updatePosition)
}

function teardown() {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
}

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  search.value = value
  emit('update:modelValue', value)
  if (!show.value) open()
  else updatePosition()
}

function onFocus() {
  open()
}

// Delay close so a mousedown on an option registers before blur hides the list.
function onBlur() {
  setTimeout(() => {
    show.value = false
    teardown()
  }, 150)
}

function select(option: string) {
  emit('update:modelValue', option)
  search.value = ''
  show.value = false
  teardown()
}

onUnmounted(teardown)
</script>

<template>
  <div class="combobox">
    <input
      ref="inputEl"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      autocomplete="off"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.enter.prevent="emit('submit')"
    />
    <Teleport to="body">
      <div v-if="show && filtered.length" class="combobox-dropdown" :style="menuStyle">
        <button
          v-for="option in filtered"
          :key="option"
          class="combobox-option"
          :class="{ selected: option === modelValue }"
          @mousedown.prevent="select(option)"
        >
          {{ option }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.combobox {
  position: relative;
}

.combobox input {
  width: 100%;
  padding: 10px var(--spacing-md);
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-medium);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-family: inherit;
}

.combobox input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.combobox-dropdown {
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-medium);
  border-radius: var(--radius-sm);
  z-index: 1100;
  max-height: 220px;
  overflow-y: auto;
  box-shadow: 0 8px 24px var(--color-shadow-dark);
}

.combobox-option {
  display: block;
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.combobox-option:hover {
  background: var(--color-bg-element);
}

.combobox-option.selected {
  color: var(--color-accent);
}
</style>
