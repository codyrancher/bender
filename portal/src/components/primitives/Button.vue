<script setup lang="ts">
// Text button. `disabled`, `@click`, `type`, `title` etc. fall through to the
// inner <button>. Variants match the old `.modal-btn` families:
//   primary   = the old `.create` (accent)
//   secondary = the old `.cancel` (muted) — default
//   danger    = outlined destructive
defineProps<{ variant?: 'primary' | 'secondary' | 'danger' }>()
</script>

<template>
  <button class="btn" :class="variant || 'secondary'"><slot /></button>
</template>

<style scoped>
.btn {
  padding: 8px 18px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  transition: background 0.15s, opacity 0.15s, color 0.15s;
}
.btn.secondary { background: var(--color-bg-element); color: var(--color-text-muted); }
.btn.secondary:hover:not(:disabled) { background: var(--color-bg-element-hover); color: var(--color-text-hover); }
.btn.primary { background: var(--color-accent); color: var(--color-text-bright); }
.btn.primary:hover:not(:disabled) { background: var(--color-accent-hover); }
.btn.danger { background: var(--color-error); color: var(--color-text-bright); }
.btn.danger:hover:not(:disabled) { background: var(--color-status-stopped); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
