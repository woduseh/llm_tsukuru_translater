<template>
  <TitleBar />
  <div class="home-content">
    <div class="hero">
      <h1>Tsukuru Extractor</h1>
      <p class="subtitle">RPG Maker 번역 도구</p>
    </div>
    <div class="card-row">
      <div class="card" @click="$router.push('/mvmz')">
        <span class="card-emoji">🎮</span>
        <span class="card-title">RPG MV/MZ</span>
        <span class="card-sub">RPG Maker MV · MZ</span>
      </div>
      <div class="card" @click="$router.push('/wolf')">
        <span class="card-emoji">🐺</span>
        <span class="card-title">Wolf RPG</span>
        <span class="card-sub">Wolf RPG Editor</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import TitleBar from '../components/TitleBar.vue'
import { api, useIpcOn } from '../composables/useIpc'

onMounted(() => {
  // Apply theme from main process
  api.on('getGlobalSettings', (tt: Record<string, unknown>) => {
    if (tt && tt.themeData) {
      const root = document.documentElement
      for (const [key, val] of Object.entries(tt.themeData as Record<string, string>)) {
        root.style.setProperty(key, val)
      }
    }
  })
  api.send('mainReady')
})
</script>

<style scoped>
.home-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
}

.hero { text-align: center; }
.hero h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
.subtitle {
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.4;
}

.card-row {
  display: flex;
  gap: 20px;
}

.card {
  width: 180px;
  padding: 32px 20px;
  background: var(--Highlight1);
  border: var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: var(--transition);
}

.card:hover {
  background: rgba(124,111,219,0.12);
  border-color: rgba(124,111,219,0.45);
  box-shadow: var(--glow);
  transform: translateY(-2px);
}

.card-emoji { font-size: 36px; }
.card-title { font-size: 16px; font-weight: 600; }
.card-sub { font-size: 11px; opacity: 0.4; }
</style>
