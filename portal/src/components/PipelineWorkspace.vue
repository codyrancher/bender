<script setup lang="ts">
// The pipeline workspace: the per-pipeline VS Code / browser iframes plus their
// toolbar. Used for the vscode/browser/split/harness routes — they all resolve
// to THIS component, so <router-view> reuses one instance across view switches
// and the iframes never reload when toggling vscode ↔ browser ↔ split.
import Toolbar from './Toolbar.vue'
import IFrameContainer from './IFrameContainer.vue'
</script>

<template>
  <div class="iframe-pane">
    <Toolbar />
    <IFrameContainer />
  </div>
</template>

<style scoped>
.iframe-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
