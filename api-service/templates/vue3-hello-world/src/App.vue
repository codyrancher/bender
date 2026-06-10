<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <div class="container">
    <h1>Hello World</h1>
    <p>Welcome to your Vue 3 + TypeScript project.</p>
    <button @click="count++">Count: {{ count }}</button>
  </div>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 80px auto;
  text-align: center;
  font-family: system-ui, sans-serif;
}

h1 {
  color: #42b883;
}

button {
  padding: 8px 16px;
  font-size: 16px;
  border-radius: 4px;
  border: 1px solid #42b883;
  background: transparent;
  color: #42b883;
  cursor: pointer;
}

button:hover {
  background: #42b883;
  color: white;
}
</style>
