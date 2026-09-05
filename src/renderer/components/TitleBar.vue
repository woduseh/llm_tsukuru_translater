<template>
  <div class="titlebar">
    <div class="app-identity">Tsukuru Console</div>
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
      aria-label="설정 열기"
    >설정</button>
    <button type="button" class="icon minimize" aria-label="창 최소화" @click="api.send('minimize')">&#x2013;</button>
    <button type="button" class="icon close" aria-label="앱 닫기" @click="api.send('close')">&times;</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api, useIpcOn } from '../composables/useIpc'
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
  useIpcOn('loading', onLoading)
  useIpcOn('loadingTag', (tt: string) => { loadingTag.value = tt })
  useIpcOn('llmTranslating', (val: boolean) => { llmTranslating.value = val })
})
</script>

<style scoped>
.titlebar {
  -webkit-app-region: drag;
  user-select: none;
  height: 38px;
  background: #0a0f12;
  display: flex;
  align-items: center;
  position: relative;
  flex-shrink: 0;
  border-bottom: 1px solid #263137;
}
.app-identity { margin-left: 14px; font-size: 12px; font-weight: 800; letter-spacing: .2px; }
.progress-bar {
  position: absolute; left: 0; top: 0; height: 38px; width: 0;
  background: rgba(255,176,32,.22);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.loading-text {
  position: absolute; left: 140px;
  font-size: 11px; opacity: 0.6; font-weight: 500; z-index: 1;
}
.icon {
  border: 0; background: transparent;
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
  width: 52px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--muted); transition: var(--transition);
  background: transparent; border: none; color: var(--mainColor); z-index: 2;
}
.settings-btn:hover { color: var(--mainColor); background: #172027; }
.abort-btn {
  -webkit-app-region: no-drag;
  position: absolute; right: 140px; top: 7px; height: 24px;
  padding: 0 14px;
  background: #9f3341;
  border: none; border-radius: 6px; color: #fff;
  font-family: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; z-index: 2; transition: var(--transition);
  box-shadow: 0 2px 8px rgba(229,57,53,0.3);
}
.abort-btn:hover { background: #bc4051; }
</style>
