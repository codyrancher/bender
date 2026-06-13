<script setup lang="ts">
// Confirm + delete a pipeline (stops/removes its container and all of its data).
import { ref } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'

const props = defineProps<{ pipeline: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const pipelinesStore = usePipelinesStore()
const deleting = ref(false)

async function confirm() {
  if (deleting.value) return
  deleting.value = true
  try {
    await pipelinesStore.deletePipeline(props.pipeline)
    emit('close')
  } catch {
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <Modal title="Delete pipeline" @close="!deleting && emit('close')">
    <div class="modal-pad">
      <p class="confirm-text">
        Delete <strong>{{ pipeline }}</strong>? This stops and removes its container and all of its data, including run history and artifacts. This cannot be undone.
      </p>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="deleting" @click="emit('close')">Cancel</Button>
      <Button variant="danger" :disabled="deleting" @click="confirm">
        {{ deleting ? 'Deleting...' : 'Delete' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.modal-pad { padding: 20px; }

.confirm-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
}

.confirm-text strong {
  color: var(--color-text-bright);
}
</style>
