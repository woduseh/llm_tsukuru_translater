<template>
  <TitleBar :show-settings="true" :show-abort-btn="true" @settings="openSettings" />
  <main class="wolf-console app-content" data-harness-view="wolf" :data-project-state="hasFolder ? 'ready' : 'empty'">
    <nav class="wolf-rail" aria-label="프로젝트 메뉴">
      <button type="button" @click="$router.push('/')">홈</button>
      <button type="button" @click="$router.push('/mvmz')">MV/MZ</button>
      <button type="button" class="active" aria-current="page">Wolf</button>
      <button type="button" @click="$router.push('/agent-workspace')">AI</button>
    </nav>
    <section class="wolf-body">
      <header class="wolf-header">
        <div><span>WOLF RPG EDITOR</span><h1>{{ hasFolder ? '프로젝트 작업공간' : '프로젝트를 선택하세요' }}</h1></div>
        <button type="button" class="btn-secondary" @click="selectFolder">{{ hasFolder ? '프로젝트 변경' : '폴더 선택' }}</button>
        <p>{{ folderPath || 'Wolf RPG 게임 폴더를 선택하면 작업을 시작할 수 있습니다.' }}</p>
      </header>
      <div class="wolf-pipeline" aria-label="번역 작업 단계">
        <button type="button" :class="{ current: !hasFolder || mode === 0 }" @click="hasFolder ? mode = 0 : selectFolder()"><b>1</b><span>추출<small>{{ !hasFolder ? '폴더 필요' : mode === 0 ? '선택됨' : '준비' }}</small></span></button>
        <button type="button" :disabled="!hasFolder" @click="openLLMTranslate"><b>2</b><span>번역<small>{{ hasFolder ? '실행 가능' : '대기' }}</small></span></button>
        <button type="button" :disabled="!hasFolder" @click="openLLMCompare"><b>3</b><span>검수<small>{{ hasFolder ? '비교 열기' : '대기' }}</small></span></button>
        <button type="button" :class="{ current: mode === 1 }" :disabled="!hasFolder" @click="mode = 1"><b>4</b><span>적용<small>{{ mode === 1 ? '선택됨' : '대기' }}</small></span></button>
      </div>
      <div class="wolf-work">
        <section class="wolf-current">
          <p>현재 작업</p>
          <h2 data-harness-current-task>{{ !hasFolder ? '프로젝트 폴더 선택' : mode === 1 ? '번역 적용' : '텍스트 추출' }}</h2>
          <span>{{ !hasFolder ? '게임 폴더를 선택하면 추출 범위와 번역 도구가 활성화됩니다.' : mode === 1 ? '검수를 마친 번역문을 게임에 적용합니다.' : 'DB와 이벤트에서 번역할 텍스트를 추출합니다.' }}</span>
          <button v-if="!hasFolder" type="button" class="btn-run" data-harness-primary-action @click="selectFolder">폴더 선택하기</button>
          <button v-else class="btn-run" data-harness-primary-action :disabled="!canRun" :title="runButtonTitle" @click="run">{{ running ? '작업 진행 중' : mode === 1 ? '번역 적용 시작' : '텍스트 추출 시작' }}</button>
          <button v-if="hasFolder" type="button" class="wolf-review" @click="openLLMCompare">번역 비교 열기</button>
        </section>
        <aside class="wolf-options">
          <div class="wolf-options-head">
            <div><span>작업 설정</span><strong>{{ !hasFolder ? '폴더 선택 후 설정' : mode === 1 ? '적용 옵션' : '추출 범위' }}</strong></div>
          </div>
          <div v-show="mode !== 1" class="options-grid wolf-option-grid">
            <button v-for="opt in extractOptions" :key="opt.key" class="option-btn" :class="{ active: config[opt.key] }" :disabled="!hasFolder" :aria-pressed="Boolean(config[opt.key])" @click="config[opt.key] = !config[opt.key]">{{ opt.label }}</button>
          </div>
          <div v-show="mode === 1" class="options-grid wolf-option-grid">
            <button class="option-btn" :class="{ active: config.autoline }" :disabled="!hasFolder" :aria-pressed="Boolean(config.autoline)" @click="config.autoline = !config.autoline">자동 줄바꿈</button>
          </div>
        </aside>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { api } from '../composables/useIpc'
import TitleBar from '../components/TitleBar.vue'
import Swal from 'sweetalert2'

const folderPath = ref('')
const mode = ref(-1)
const running = ref(false)
const hasFolder = computed(() => folderPath.value.trim().length > 0)
const hasMode = computed(() => mode.value === 0 || mode.value === 1)
const canRun = computed(() => hasFolder.value && hasMode.value && !running.value)
const runButtonTitle = computed(() => {
  if (running.value) return '작업이 진행 중입니다'
  if (!hasFolder.value) return '프로젝트 폴더를 먼저 선택하세요'
  if (!hasMode.value) return '추출 또는 적용을 선택하세요'
  return mode.value === 0 ? '추출을 시작합니다' : '적용을 시작합니다'
})

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

function run() {
  if (guardRunning()) return
  if (!hasFolder.value) {
    Swal.fire({ icon: 'warning', text: '프로젝트 폴더를 먼저 선택하세요.' })
    return
  }
  if (!hasMode.value) {
    Swal.fire({ icon: 'warning', text: '추출 또는 적용을 선택하세요.' })
    return
  }
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
  if (!dir) {
    Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' })
    return
  }
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
      if (mode.value === -1) mode.value = 0
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

<style scoped>
.wolf-console { display: grid; grid-template-columns: 70px 1fr; }
.wolf-rail { background: #0b1114; border-right: var(--border); padding: 13px 8px; display: flex; flex-direction: column; gap: 7px; }
.wolf-rail button { min-height: 42px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 800; cursor: pointer; }
.wolf-rail button:hover { color: var(--mainColor); background: #162027; }
.wolf-rail button.active { background: #1c272d; color: var(--Accent); border-left: 3px solid var(--Accent); }
.wolf-rail button:last-child { margin-top: auto; }
.wolf-body { min-width: 0; display: flex; flex-direction: column; }
.wolf-header { position: relative; min-height: 94px; padding: 14px 18px 12px; border-bottom: var(--border); }
.wolf-header span { color: var(--Healthy); font-size: 10px; font-weight: 900; letter-spacing: .9px; }
.wolf-header h1 { margin-top: 3px; font-size: 20px; }
.wolf-header > button { position: absolute; top: 15px; right: 18px; }
.wolf-header p { margin-top: 11px; max-width: calc(100% - 150px); overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.wolf-pipeline { height: 66px; display: grid; grid-template-columns: repeat(4,1fr); border-bottom: var(--border); }
.wolf-pipeline button { display: flex; align-items: center; justify-content: center; gap: 9px; border: 0; border-right: var(--border); background: transparent; color: var(--muted); cursor: pointer; }
.wolf-pipeline button:last-child { border-right: 0; }
.wolf-pipeline button.current { box-shadow: inset 0 2px var(--Accent); color: var(--mainColor); background: #171b18; }
.wolf-pipeline button:disabled { opacity: .42; cursor: default; }
.wolf-pipeline b { display: grid; place-items: center; width: 27px; height: 27px; border: 1px solid #526068; border-radius: 50%; }
.wolf-pipeline .current b { border-color: var(--Accent); color: var(--Accent); }
.wolf-pipeline span, .wolf-pipeline small { display: block; text-align: left; }
.wolf-pipeline span { font-weight: 800; }
.wolf-pipeline small { color: var(--subtle); font-size: 11px; font-weight: 600; }
.wolf-work { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.05fr .95fr; }
.wolf-current, .wolf-options { padding: 17px 18px; }
.wolf-current { border-right: var(--border); }
.wolf-current > p { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .9px; }
.wolf-current h2 { margin-top: 8px; font-size: 24px; }
.wolf-current > span { display: block; min-height: 44px; margin-top: 7px; color: var(--muted); font-size: 12px; }
.wolf-current .btn-run { width: 100%; margin: 18px 0 0; padding: 12px; }
.wolf-review { width: 100%; margin-top: 8px; padding: 9px; border: var(--border); border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
.wolf-review:disabled { opacity: .35; cursor: default; }
.wolf-options-head { display: flex; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: var(--border); }
.wolf-options-head span, .wolf-options-head strong { display: block; }
.wolf-options-head span { color: var(--muted); font-size: 10px; }
.wolf-option-grid { margin-top: 12px; grid-template-columns: 1fr; }
</style>
