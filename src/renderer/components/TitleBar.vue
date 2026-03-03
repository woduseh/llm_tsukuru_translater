<template>
  <div class="titlebar" :style="{ WebkitAppRegion: 'drag' }">
    <div class="progress-bar" :style="{ width: progressWidth }"></div>
    <div class="loading-text" v-show="progress > 0">
      {{ loadingTag }}{{ loadingTag ? ' · ' : '' }}{{ progress.toFixed(1) }}% {{ estimatedTime }}
    </div>
    <button
      v-if="showAbortBtn && llmTranslating"
      class="abort-btn"
      @click="onAbort"
    >번역 중단</button>
    <button
      v-if="showSettings"
      class="settings-btn"
      @click="$emit('settings')"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
        <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
      </svg>
    </button>
    <div class="icon minimize" @click="api.send('minimize')">&#x2013;</div>
    <div class="icon close" @click="api.send('close')">&times;</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../composables/useIpc'
import Swal from 'sweetalert2'

defineProps<{
  showSettings?: boolean
  showAbortBtn?: boolean
}>()

defineEmits<{
  settings: []
}>()

const progress = ref(0)
const loadingTag = ref('')
const estimatedTime = ref('')
const llmTranslating = ref(false)
const lastTime = ref(-1)
const lastPercent = ref(-1.0)
const speedSamples = ref<number[]>([])
const ETA_WINDOW = 10

const progressWidth = computed(() => `${progress.value}vw`)

function toHHMMSS(num: number): string {
  const sec = Math.max(0, Math.round(num))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  let t = ''
  if (h > 0) t += `${h}시간 `
  if (m > 0) t += `${m}분 `
  t += `${s}초`
  return t
}

function onLoading(tt: number) {
  progress.value = tt
  const ds = Math.floor(Date.now() / 1000)
  if (tt > 0) {
    if (lastTime.value !== ds) {
      const dt = ds - lastTime.value
      lastTime.value = ds
      const oldP = lastPercent.value
      lastPercent.value = tt
      const moved = (lastPercent.value - oldP) / dt
      if (moved > 0) {
        speedSamples.value.push(moved)
        if (speedSamples.value.length > ETA_WINDOW) speedSamples.value.shift()
      }
      if (speedSamples.value.length > 0) {
        const avg = speedSamples.value.reduce((a, b) => a + b, 0) / speedSamples.value.length
        estimatedTime.value = `${toHHMMSS((100 - lastPercent.value) / avg)} 남음`
      }
    }
  } else {
    speedSamples.value = []
    estimatedTime.value = ''
    lastTime.value = ds
    lastPercent.value = -1.0
    loadingTag.value = ''
  }
}

async function onAbort() {
  const result = await Swal.fire({
    icon: 'warning',
    text: '번역을 중단하시겠습니까?\n현재까지의 진행 상태는 저장됩니다.',
    confirmButtonText: '중단',
    showDenyButton: true,
    denyButtonText: '계속',
  })
  if (result.isConfirmed) {
    api.send('abortLLM')
  }
}

onMounted(() => {
  api.on('loading', onLoading)
  api.on('loadingTag', (tt: string) => { loadingTag.value = tt })
  api.on('llmTranslating', (val: boolean) => { llmTranslating.value = val })
})

onUnmounted(() => {
  api.removeAllListeners('loading')
  api.removeAllListeners('loadingTag')
  api.removeAllListeners('llmTranslating')
})
</script>

<style scoped>
.titlebar {
  -webkit-app-region: drag;
  user-select: none;
  height: 38px;
  background: var(--Highlight2);
  display: flex;
  align-items: center;
  position: relative;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.progress-bar {
  position: absolute; left: 0; top: 0; height: 38px; width: 0;
  background: linear-gradient(90deg, rgba(124,111,219,0.25), rgba(124,111,219,0.08));
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.loading-text {
  position: absolute; left: 14px;
  font-size: 11px; opacity: 0.6; font-weight: 500; z-index: 1;
}
.icon {
  -webkit-app-region: no-drag;
  width: 40px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 14px; opacity: 0.45;
  transition: var(--transition); color: var(--mainColor);
}
.icon:hover { opacity: 1; background: rgba(255,255,255,0.06); }
.icon.close { position: absolute; right: 0; top: 0; }
.icon.close:hover { background: #e81123; opacity: 1; }
.icon.minimize { position: absolute; right: 40px; top: 0; }
.settings-btn {
  -webkit-app-region: no-drag;
  position: absolute; right: 80px; top: 0;
  width: 40px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0.45; transition: var(--transition);
  background: transparent; border: none; color: var(--mainColor); z-index: 2;
}
.settings-btn:hover { opacity: 1; background: rgba(255,255,255,0.06); }
.abort-btn {
  -webkit-app-region: no-drag;
  position: absolute; right: 128px; top: 7px; height: 24px;
  padding: 0 14px;
  background: linear-gradient(135deg, #e53935, #c62828);
  border: none; border-radius: 6px; color: #fff;
  font-family: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; z-index: 2; transition: var(--transition);
  box-shadow: 0 2px 8px rgba(229,57,53,0.3);
}
.abort-btn:hover { background: linear-gradient(135deg, #ef5350, #e53935); }
</style>
