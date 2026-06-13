<script setup lang="ts">
// Assembles the global Claude CLI surface: a resizable Drawer hosting the
// Terminal, plus the CLAUDE.md editor modal it can open.
import { ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import Drawer from './Drawer.vue'
import Terminal from './Terminal.vue'
import ClaudeEditorModal from './ClaudeEditorModal.vue'

const ui = useUiStore()
const showEditor = ref(false)
</script>

<template>
  <Drawer :open="ui.terminalOpen">
    <Terminal @open-editor="showEditor = true" />
  </Drawer>
  <ClaudeEditorModal v-model:open="showEditor" />
</template>
