<script setup lang="ts">
// Rendered on every request: the timestamp changes on each reload.
useResponseHeader('cache-control').value = 'no-store';
const renderedAt = useState('renderedAt', () => new Date().toISOString());
</script>

<template>
  <h1>Nuxt on Lambda Web Functions</h1>
  <p>
    Rendered on the server at <time>{{ renderedAt }}</time
    >.
  </p>
</template>
