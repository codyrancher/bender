<script setup lang="ts">
// Labeled form field wrapper: label (+ required marker) and optional hint above
// the control (default slot). Replaces the ad-hoc form-group/imp-group/field-group.
defineProps<{ label?: string; hint?: string; required?: boolean }>()
</script>

<template>
  <div class="form-field">
    <label v-if="label" class="ff-label">{{ label }}<span v-if="required" class="ff-req">*</span></label>
    <p v-if="hint" class="ff-hint">{{ hint }}</p>
    <slot />
  </div>
</template>

<style scoped>
.form-field { display: flex; flex-direction: column; gap: 6px; }
.ff-label { font-size: 12px; font-weight: 600; color: var(--color-text-muted); }
.ff-req { color: var(--color-error); margin-left: 2px; }
.ff-hint { font-size: 12px; color: var(--color-text-muted); margin: 0; }
</style>
