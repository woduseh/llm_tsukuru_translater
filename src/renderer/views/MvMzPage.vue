<template>
  <TitleBar :show-settings="true" :show-abort-btn="true" @settings="openSettings" />

  <div class="app-content">
    <!-- Folder selection -->
    <section>
      <label class="section-label" @click="openFolder">프로젝트 폴더</label>
      <div class="folder-row">
        <input type="text" v-model="folderPath" class="input" placeholder="data 폴더 경로를 선택하세요">
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
        <button class="btn-run" :disabled="!canRun" :title="runButtonTitle" @click="run">RUN</button>
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
        <button v-for="opt in applyOptions" :key="opt.key"
          class="option-btn" :class="{ active: config[opt.key] }"
          @click="config[opt.key] = !config[opt.key]">
          {{ opt.label }}
        </button>
      </div>
    </section>

    <!-- Tools -->
    <section>
      <label class="section-label">도구</label>
      <div class="tools-primary">
        <button class="tool-btn primary" @click="openLLMTranslate">번역</button>
        <button class="tool-btn primary" @click="openLLMCompare">번역 비교</button>
        <button class="tool-btn primary" @click="openJsonVerify">JSON 검증</button>
      </div>
      <div class="tools-secondary">
        <button class="tool-btn secondary" @click="openVersionUp">버전 업</button>
        <button class="tool-btn secondary" @click="openFontConfig">폰트</button>
        <button class="tool-btn secondary" @click="convertProject">프로젝트 변환</button>
      </div>
    </section>
  </div>

  <!-- Page tabs -->
  <div class="page-tabs">
    <div class="page-tab active">MV/MZ</div>
    <div class="page-tab" @click="$router.push('/wolf')">Wolf RPG</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { api } from '../composables/useIpc'
import TitleBar from '../components/TitleBar.vue'
import Swal from 'sweetalert2'

const folderPath = ref('')
const mode = ref(-1) // -1=none, 0=extract, 1=apply
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
  ext_plugin: false, ext_src: false, autoline: false,
  instantapply: false, ext_note: false, exJson: false,
  decryptImg: false, decryptAudio: false, ext_javascript: false,
})

const extractOptions = [
  { key: 'ext_plugin', label: '플러그인' },
  { key: 'ext_src', label: '스크립트' },
  { key: 'ext_note', label: '노트 / 메모' },
  { key: 'exJson', label: '비표준 리소스' },
  { key: 'decryptImg', label: '이미지 복호화' },
  { key: 'decryptAudio', label: '오디오 복호화' },
]

const applyOptions = [
  { key: 'autoline', label: '자동 줄바꿈' },
  { key: 'instantapply', label: '즉시 적용' },
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
  if (!hasFolder.value) {
    Swal.fire({ icon: 'warning', text: '프로젝트 폴더를 먼저 선택하세요.' })
    return
  }
  if (!hasMode.value) {
    Swal.fire({ icon: 'warning', text: '추출 또는 적용을 선택하세요.' })
    return
  }
  const dir = window.nodeBuffer.toBase64(folderPath.value.replace('\\', '/'))
  if (mode.value === 0) {
    running.value = true
    api.send('extract', { dir, ...config })
  } else if (mode.value === 1) {
    running.value = true
    api.send('apply', { dir, ...config })
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
  api.send('openLLMSettings', { dir, game: 'mvmz' })
}

function openLLMCompare() {
  const dir = folderPath.value.replaceAll('\\', '/')
  if (!dir) {
    Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' })
    return
  }
  api.send('openLLMCompare', dir)
}

function openJsonVerify() {
  const dir = folderPath.value.replaceAll('\\', '/')
  if (!dir) {
    Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' })
    return
  }
  api.send('openJsonVerify', dir)
}

async function openVersionUp() {
  if (guardRunning()) return
  const { value: formValues } = await Swal.fire({
    title: '버전 업',
    html: `
      <div style="text-align:left;font-size:13px;">
        <label style="display:block;margin-bottom:4px;">구버전 번역본 폴더</label>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input id="swal-old-trans" class="swal2-input" style="flex:1;margin:0;" placeholder="구버전 번역된 data 폴더" readonly>
          <button type="button" id="btn-old-trans" class="swal2-confirm swal2-styled" style="padding:6px 14px;font-size:12px;margin:0;">찾아보기</button>
        </div>
        <label style="display:block;margin-bottom:4px;">구버전 미번역 폴더</label>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input id="swal-old-orig" class="swal2-input" style="flex:1;margin:0;" placeholder="구버전 원본 data 폴더" readonly>
          <button type="button" id="btn-old-orig" class="swal2-confirm swal2-styled" style="padding:6px 14px;font-size:12px;margin:0;">찾아보기</button>
        </div>
        <label style="display:block;margin-bottom:4px;">신버전 폴더</label>
        <div style="display:flex;gap:6px;">
          <input id="swal-new" class="swal2-input" style="flex:1;margin:0;" placeholder="신버전 data 폴더" readonly>
          <button type="button" id="btn-new" class="swal2-confirm swal2-styled" style="padding:6px 14px;font-size:12px;margin:0;">찾아보기</button>
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '실행',
    cancelButtonText: '취소',
    preConfirm: () => {
      return {
        oldTrans: (document.getElementById('swal-old-trans') as HTMLInputElement).value,
        oldOrig: (document.getElementById('swal-old-orig') as HTMLInputElement).value,
        newDir: (document.getElementById('swal-new') as HTMLInputElement).value,
      }
    },
    didOpen: (popup: HTMLElement) => {
      const bindBrowse = (btnId: string, inputId: string) => {
        const btn = popup.querySelector(`#${btnId}`) as HTMLButtonElement
        if (btn) {
          btn.addEventListener('click', () => {
            api.send('select_folder', inputId)
          })
        }
      }
      bindBrowse('btn-old-trans', 'swal-old-trans')
      bindBrowse('btn-old-orig', 'swal-old-orig')
      bindBrowse('btn-new', 'swal-new')
    },
  })
  if (formValues) {
    running.value = true
    api.send('updateVersion', formValues)
  }
}

async function openFontConfig() {
  if (guardRunning()) return
  if (!folderPath.value) {
    Swal.fire({ icon: 'warning', title: '프로젝트 폴더를 먼저 선택하세요', background: 'var(--Highlight1)', color: 'var(--mainColor)' })
    return
  }
  const { value: fontSize } = await Swal.fire({
    title: '폰트 사이즈 변경',
    input: 'number',
    inputLabel: '변경할 폰트 사이즈를 입력하세요 (기본값: 28)',
    inputPlaceholder: '28',
    inputAttributes: { min: '8', max: '100', step: '1' },
    showCancelButton: true,
    confirmButtonText: '변경',
    cancelButtonText: '취소',
    background: 'var(--Highlight1)',
    color: 'var(--mainColor)',
    inputValidator: (value) => {
      if (!value) return '폰트 사이즈를 입력하세요'
      const n = Number(value)
      if (isNaN(n) || n < 8 || n > 100) return '8~100 사이의 숫자를 입력하세요'
      return null
    },
  })
  if (fontSize) {
    api.send('changeFontSize', [folderPath.value, Number(fontSize)])
  }
}

function convertProject() {
  if (guardRunning()) return
  if (!hasFolder.value) {
    Swal.fire({ icon: 'warning', text: '프로젝트 폴더를 먼저 선택하세요.' })
    return
  }
  api.send('projectConvert', folderPath.value)
}

onMounted(() => {
  api.send('setheight', 550)

  api.on('set_path', (tt: Record<string, string>) => {
    if (tt && tt.type) {
      if (tt.type === 'folder_input') {
        folderPath.value = tt.dir
      }
      // Handle version-up modal folder selects
      const el = document.getElementById(tt.type) as HTMLInputElement | null
      if (el) el.value = tt.dir
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

  api.on('check_force', async () => {
    const { isConfirmed } = await Swal.fire({
      icon: 'question',
      title: '이미 추출된 파일이 있습니다.\n덮어쓰시겠습니까?',
      confirmButtonText: '덮어쓰기',
      showCancelButton: true,
      cancelButtonText: '취소',
    })
    if (isConfirmed) {
      const dir = window.nodeBuffer.toBase64(folderPath.value.replace('\\', '/'))
      api.send('extract', { dir, ...config, force: true })
    } else {
      running.value = false
    }
  })
})

onUnmounted(() => {
  for (const ch of ['set_path', 'getGlobalSettings', 'worked', 'alert2', 'alertExten', 'check_force']) {
    api.removeAllListeners(ch)
  }
})
</script>
