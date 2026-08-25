<template>
  <TitleBar :show-settings="true" :show-abort-btn="true" @settings="openSettings" />
  <main class="project-console app-content" data-harness-view="mvmz" :data-project-state="hasFolder ? 'ready' : 'empty'">
    <nav class="console-rail" aria-label="프로젝트 메뉴">
      <button type="button" @click="$router.push('/')">홈</button>
      <button type="button" class="active" aria-current="page">MV/MZ</button>
      <button type="button" @click="$router.push('/wolf')">Wolf</button>
      <button type="button" @click="$router.push('/agent-workspace')">AI</button>
    </nav>
    <section class="console-body">
      <header class="project-header">
        <div>
          <span>RPG MAKER MV / MZ</span>
          <h1>{{ hasFolder ? '프로젝트 작업공간' : '프로젝트를 선택하세요' }}</h1>
        </div>
        <button type="button" class="btn-secondary" @click="selectFolder">{{ hasFolder ? '프로젝트 변경' : '폴더 선택' }}</button>
        <div class="project-path">
          <button v-if="hasFolder" type="button" @click="openFolder">폴더 열기</button>
          <span>{{ folderPath || '게임의 data 폴더를 선택하면 작업을 시작할 수 있습니다.' }}</span>
        </div>
      </header>

      <div class="pipeline" aria-label="번역 작업 단계">
        <button type="button" :class="{ current: !hasFolder || mode === 0 }" @click="hasFolder ? mode = 0 : selectFolder()"><b>1</b><span>추출<small>{{ !hasFolder ? '폴더 필요' : mode === 0 ? '선택됨' : '준비' }}</small></span></button>
        <button type="button" :disabled="!hasFolder" @click="openLLMTranslate"><b>2</b><span>번역<small>{{ hasFolder ? '실행 가능' : '대기' }}</small></span></button>
        <button type="button" :disabled="!hasFolder" @click="openLLMCompare"><b>3</b><span>검수<small>{{ hasFolder ? '비교 열기' : '대기' }}</small></span></button>
        <button type="button" :class="{ current: mode === 1 }" :disabled="!hasFolder" @click="mode = 1"><b>4</b><span>적용<small>{{ mode === 1 ? '선택됨' : '대기' }}</small></span></button>
      </div>

      <div class="work-grid">
        <section class="current-task">
          <p class="eyebrow">현재 작업</p>
          <h2 data-harness-current-task>{{ !hasFolder ? '프로젝트 폴더 선택' : mode === 1 ? '번역 적용' : '텍스트 추출' }}</h2>
          <p>{{ !hasFolder ? '게임의 data 폴더를 선택하면 추출 옵션과 번역 도구가 활성화됩니다.' : mode === 1 ? '검수를 마친 번역문을 게임 데이터에 적용합니다.' : '게임 데이터에서 번역할 텍스트와 구조 정보를 추출합니다.' }}</p>
          <button v-if="!hasFolder" type="button" class="btn-run" data-harness-primary-action @click="selectFolder">폴더 선택하기</button>
          <button v-else class="btn-run" data-harness-primary-action :disabled="!canRun" :title="runButtonTitle" @click="run">
            {{ running ? '작업 진행 중' : mode === 1 ? '번역 적용 시작' : '텍스트 추출 시작' }}
          </button>
          <button v-if="hasFolder" type="button" class="review-link" @click="openJsonVerify">JSON 구조 검증 열기</button>
        </section>

        <aside class="task-options">
          <div class="options-heading">
            <div><span>작업 설정</span><strong>{{ !hasFolder ? '폴더 선택 후 설정' : mode === 1 ? '적용 옵션' : '추출 옵션' }}</strong></div>
          </div>
          <div v-show="mode !== 1" class="options-grid">
            <button v-for="opt in extractOptions" :key="opt.key" class="option-btn" :class="{ active: config[opt.key] }" :disabled="!hasFolder" :aria-pressed="Boolean(config[opt.key])" @click="config[opt.key] = !config[opt.key]">{{ opt.label }}</button>
          </div>
          <div v-show="mode === 1" class="options-grid apply-options">
            <button v-for="opt in applyOptions" :key="opt.key" class="option-btn" :class="{ active: config[opt.key] }" :disabled="!hasFolder" :aria-pressed="Boolean(config[opt.key])" @click="config[opt.key] = !config[opt.key]">{{ opt.label }}</button>
          </div>
          <div class="secondary-tools">
            <button type="button" @click="openVersionUp">버전 업</button>
            <button type="button" @click="selectFontFile">폰트 파일</button>
            <button type="button" @click="openFontConfig">폰트 크기</button>
            <button type="button" @click="convertProject">프로젝트 변환</button>
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
import type { VersionUpRequest } from '../../ts/rpgmv/types'

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
  { key: 'ext_javascript', label: 'JavaScript 문자열' },
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
  const dir = window.nodeBuffer.toBase64(folderPath.value.replaceAll('\\', '/'))
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
  const { isConfirmed } = await Swal.fire({
    icon: 'warning',
    title: '버전 업 전 확인',
    text: '현재 추출 옵션으로 구버전 원문과 신버전을 다시 추출합니다. 신버전 data 폴더의 기존 Extract와 Backup은 성공 시 새 결과로 교체됩니다.',
    showCancelButton: true,
    confirmButtonText: '계속',
    cancelButtonText: '취소',
  })
  if (!isConfirmed) return

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
      const oldTranslatedDir = (document.getElementById('swal-old-trans') as HTMLInputElement).value.trim()
      const oldOriginalDir = (document.getElementById('swal-old-orig') as HTMLInputElement).value.trim()
      const newDir = (document.getElementById('swal-new') as HTMLInputElement).value.trim()
      if (!oldTranslatedDir || !oldOriginalDir || !newDir) {
        Swal.showValidationMessage('세 폴더를 모두 선택하세요.')
        return false
      }
      const normalized = [oldTranslatedDir, oldOriginalDir, newDir].map((dir) => dir.replaceAll('\\', '/').toLowerCase())
      if (new Set(normalized).size !== normalized.length) {
        Swal.showValidationMessage('서로 다른 세 폴더를 선택하세요.')
        return false
      }
      return { oldTranslatedDir, oldOriginalDir, newDir }
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
    const request: VersionUpRequest = {
      ...formValues,
      extractOptions: {
        ext_src: config.ext_src,
        ext_note: config.ext_note,
        ext_plugin: config.ext_plugin,
        ext_javascript: config.ext_javascript,
        exJson: config.exJson,
        autoline: config.autoline,
      },
    }
    running.value = true
    api.send('updateVersion', request)
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

function selectFontFile() {
  if (guardRunning()) return
  if (!folderPath.value) {
    Swal.fire({ icon: 'warning', title: '프로젝트 폴더를 먼저 선택하세요', background: 'var(--Highlight1)', color: 'var(--mainColor)' })
    return
  }
  api.send('selFont', folderPath.value)
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
        if (mode.value === -1) mode.value = 0
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
      const dir = window.nodeBuffer.toBase64(folderPath.value.replaceAll('\\', '/'))
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

<style scoped>
.project-console { display: grid; grid-template-columns: 70px 1fr; }
.console-rail { background: #0b1114; border-right: var(--border); padding: 13px 8px; display: flex; flex-direction: column; gap: 7px; }
.console-rail button { min-height: 42px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 800; cursor: pointer; }
.console-rail button:hover { color: var(--mainColor); background: #162027; }
.console-rail button.active { background: #1c272d; color: var(--Accent); border-left: 3px solid var(--Accent); }
.console-rail button:last-child { margin-top: auto; }
.console-body { min-width: 0; display: flex; flex-direction: column; }
.project-header { position: relative; min-height: 94px; padding: 14px 18px 12px; border-bottom: var(--border); }
.project-header > div:first-child span { color: var(--Healthy); font-size: 10px; font-weight: 900; letter-spacing: .9px; }
.project-header h1 { margin-top: 3px; font-size: 20px; }
.project-header > .btn-secondary { position: absolute; top: 15px; right: 18px; }
.project-path { margin-top: 11px; display: flex; gap: 9px; align-items: center; min-width: 0; color: var(--muted); font-size: 12px; }
.project-path span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-path button { padding: 3px 7px; border: var(--border); border-radius: 4px; background: transparent; color: var(--Healthy); cursor: pointer; font-size: 11px; }
.pipeline { height: 66px; display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: var(--border); }
.pipeline button { display: flex; align-items: center; justify-content: center; gap: 9px; border: 0; border-right: var(--border); background: transparent; color: var(--muted); cursor: pointer; }
.pipeline button:last-child { border-right: 0; }
.pipeline button:not(:disabled):hover { background: #151f24; color: var(--mainColor); }
.pipeline button.current { box-shadow: inset 0 2px var(--Accent); color: var(--mainColor); background: #171b18; }
.pipeline button:disabled { opacity: .42; cursor: default; }
.pipeline b { display: grid; place-items: center; width: 27px; height: 27px; border: 1px solid #526068; border-radius: 50%; }
.pipeline .current b { border-color: var(--Accent); color: var(--Accent); }
.pipeline span, .pipeline small { display: block; text-align: left; }
.pipeline span { font-weight: 800; }
.pipeline small { margin-top: 1px; color: var(--subtle); font-size: 11px; font-weight: 600; }
.work-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.05fr .95fr; }
.current-task, .task-options { min-width: 0; padding: 17px 18px; }
.current-task { border-right: var(--border); }
.eyebrow { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .9px; }
.current-task h2 { margin-top: 8px; font-size: 24px; }
.current-task > p:nth-of-type(2) { min-height: 44px; margin-top: 7px; color: var(--muted); font-size: 12px; }
.current-task .btn-run { width: 100%; margin: 18px 0 0; padding: 12px; }
.review-link { width: 100%; margin-top: 8px; padding: 9px; border: var(--border); border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
.review-link:hover:not(:disabled) { color: var(--mainColor); border-color: #4b5b63; }
.review-link:disabled { opacity: .35; cursor: default; }
.options-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: var(--border); }
.options-heading span, .options-heading strong { display: block; }
.options-heading span { color: var(--muted); font-size: 10px; }
.options-heading strong { margin-top: 2px; }
.task-options .options-grid { margin-top: 12px; grid-template-columns: repeat(2, 1fr); }
.task-options .option-btn { min-height: 34px; font-size: 11px; }
.apply-options { grid-template-columns: 1fr !important; }
.secondary-tools { margin-top: 12px; padding-top: 10px; border-top: var(--border); display: flex; flex-wrap: wrap; gap: 6px; }
.secondary-tools button { padding: 5px 8px; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 12px; }
.secondary-tools button:hover { color: var(--Healthy); }
</style>
