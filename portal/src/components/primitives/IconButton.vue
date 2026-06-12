<script setup lang="ts">
// Square, transparent icon button (icon goes in the default slot as an <svg>).
// `title`, `@click`, `disabled` fall through to the inner <button>.
defineProps<{ variant?: 'default' | 'danger'; active?: boolean }>()
</script>

<template>
  <button class="icon-btn" :class="[variant === 'danger' && 'danger', active && 'active']">
    <slot />
  </button>
</template>

<style scoped>
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 5px;
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover { background: var(--color-bg-element); color: var(--color-text-hover); }
.icon-btn.active { color: var(--color-accent); background: var(--color-bg-element); }
.icon-btn.danger:hover { color: var(--color-error); }
</style>
