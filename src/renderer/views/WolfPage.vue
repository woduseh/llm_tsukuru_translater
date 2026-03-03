<template>
  <TitleBar :show-settings="true" :show-abort-btn="true" @settings="openSettings" />

  <div class="app-content">
    <!-- Folder selection -->
    <section>
      <label class="section-label" @click="openFolder">프로젝트 폴더</label>
      <div class="folder-row">
        <input type="text" v-model="folderPath" class="input" placeholder="게임 폴더 경로를 선택하세요">
        <button class="btn-secondary" @click="selectFolder">찾아보기</button>
      </div>
    </section>

    <!-- Mode + Run -->
    <section>
      <div class="mode-row">
        <div class="mode-tabs">
          <button class="mode-tab" :class="{ active: mode === 0 }" @click="mode = 0">추출</button>
          <button class="mode-tab" :class="{ active: mode === 1 }" @click="mode = 1">적용</button>
        </div>
        <button class="btn-run" @click="run">RUN</button>
      </div>
    </section>

    <!-- Extract options -->
    <section v-show="mode === 0">
      <div class="options-grid">
        <button v-for="opt in extractOptions" :key="opt.key"
          class="option-btn" :class="{ active: config[opt.key] }"
          @click="config[opt.key] = !config[opt.key]">
          {{ opt.label }}
        </button>
      </div>
    </section>

    <!-- Apply options -->
    <section v-show="mode === 1">
      <div class="options-grid">
        <button class="option-btn" :class="{ active: config.autoline }"
          @click="config.autoline = !config.autoline">자동 줄바꿈</button>
      </div>
    </section>

    <!-- Tools -->
    <section>
      <label class="section-label">도구</label>
      <div class="tools-primary">
        <button class="tool-btn primary" @click="openLLMTranslate">번역</button>
        <button class="tool-btn primary" @click="openLLMCompare">번역 비교</button>
      </div>
    </section>
  </div>

  <!-- Page tabs -->
  <div class="page-tabs">
    <div class="page-tab" @click="$router.push('/mvmz')">MV/MZ</div>
    <div class="page-tab active">Wolf RPG</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { api } from '../composables/useIpc'
import TitleBar from '../components/TitleBar.vue'
import Swal from 'sweetalert2'

const folderPath = ref('')
const mode = ref(-1)
const running = ref(false)

const config = reactive<Record<string, boolean>>({
  autoline: false,
})

const extractOptions = [
  { key: 'ext_db', label: 'DB 데이터' },
  { key: 'ext_ce', label: '커먼 이벤트' },
  { key: 'ext_map', label: '맵 이벤트' },
]

function guardRunning(): boolean {
  if (running.value) {
    Swal.fire({ icon: 'error', text: '이미 다른 작업이 시행중입니다!' })
    return true
  }
  return false
}

function selectFolder() {
  api.send('select_folder', 'folder_input')
}

function openFolder() {
  if (folderPath.value) api.send('openFolder', folderPath.value)
}

function run() {
  if (guardRunning()) return
  running.value = true
  if (mode.value === 0) {
    api.send('wolf_ext', { folder: folderPath.value, config })
  } else if (mode.value === 1) {
    api.send('wolf_apply', { folder: folderPath.value, config })
  }
}

function openSettings() {
  if (guardRunning()) return
  api.send('settings')
  running.value = true
}

function openLLMTranslate() {
  if (guardRunning()) return
  const dir = folderPath.value.replaceAll('\\', '/')
  api.send('openLLMSettings', { dir, game: 'wolf' })
}

function openLLMCompare() {
  const dir = folderPath.value.replaceAll('\\', '/')
  if (!dir) {
    Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' })
    return
  }
  api.send('openLLMCompare', dir)
}

onMounted(() => {
  api.send('setheight', 550)

  api.on('set_path', (tt: Record<string, string>) => {
    if (tt && tt.type === 'folder_input') {
      folderPath.value = tt.dir
    }
  })

  api.on('getGlobalSettings', (tt: Record<string, unknown>) => {
    if (tt && tt.themeData) {
      const root = document.documentElement
      for (const [key, val] of Object.entries(tt.themeData as Record<string, string>)) {
        root.style.setProperty(key, val)
      }
    }
  })

  api.on('worked', () => { running.value = false })

  api.on('alert2', async () => {
    const { isDenied } = await Swal.fire({
      icon: 'success',
      showDenyButton: true,
      denyButtonText: '폴더 열기',
      title: '완료되었습니다',
    })
    if (isDenied) {
      api.send('openFolder', folderPath.value)
    }
  })

  api.on('alertExten', async (arg: unknown) => {
    if (!Array.isArray(arg)) return
    const { isDenied } = await Swal.fire({
      icon: 'success',
      showDenyButton: true,
      denyButtonText: '아니요',
      title: String(arg[0]),
    })
    if (!isDenied) {
      api.send('getextention', String(arg[1]))
    } else {
      api.send('getextention', 'none')
    }
  })
})

onUnmounted(() => {
  for (const ch of ['set_path', 'getGlobalSettings', 'worked', 'alert2', 'alertExten']) {
    api.removeAllListeners(ch)
  }
})
</script>
