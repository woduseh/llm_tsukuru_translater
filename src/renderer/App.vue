<template>
  <div class="app-root">
    <router-view />
    <AgentTerminalDrawer />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import AgentTerminalDrawer from './components/AgentTerminalDrawer.vue'
import { api } from './composables/useIpc'
import Swal from 'sweetalert2'

// Global alert handler shared across all pages
onMounted(() => {
  api.on('alert', (tt: unknown) => {
    if (typeof tt === 'string') {
      Swal.fire({ icon: 'success', title: tt })
    } else if (tt && typeof tt === 'object') {
      const obj = tt as Record<string, unknown>
      Swal.fire({
        icon: (obj.icon as any) || 'info',
        title: (obj.message as string) || '',
      })
    }
  })

  api.on('alert_free', (tt: unknown) => {
    if (typeof tt === 'string') {
      Swal.fire({ icon: 'info', title: tt })
    }
  })
})
</script>

<style scoped>
.app-root {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
