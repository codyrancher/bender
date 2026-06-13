<script setup lang="ts">
// A free-text input with a filtered dropdown of suggestions. Typing both sets
// the value (free-form) and filters the list; picking an option sets the value.
// v-model is the string value; emits `submit` on Enter.
import { ref, computed } from 'vue'

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

const filtered = computed(() => {
  const s = search.value.toLowerCase()
  if (!s) return props.options
  return props.options.filter((o) => o.toLowerCase().includes(s))
})

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  search.value = value
  emit('update:modelValue', value)
  show.value = true
}

function onFocus() {
  show.value = true
}

// Delay close so a mousedown on an option registers before blur hides the list.
function onBlur() {
  setTimeout(() => { show.value = false }, 150)
}

function select(option: string) {
  emit('update:modelValue', option)
  search.value = ''
  show.value = false
}
</script>

<template>
  <div class="combobox">
    <input
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      autocomplete="off"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.enter.prevent="emit('submit')"
    />
    <div v-if="show && filtered.length" class="combobox-dropdown">
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
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-medium);
  border-top: none;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  z-index: 10;
  max-height: 160px;
  overflow-y: auto;
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
