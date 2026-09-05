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
      <div class="wolf-pipeline" aria-label="번역 작업 도구">
        <button type="button" :class="{ current: !hasFolder || mode === 0 }" @click="hasFolder ? mode = 0 : selectFolder()"><b>1</b><span>추출<small>{{ !hasFolder ? '폴더 필요' : mode === 0 ? '선택됨' : '준비' }}</small></span></button>
        <button type="button" :disabled="!hasFolder" @click="openLLMTranslate"><b>2</b><span>번역<small>{{ hasFolder ? '범위 설정' : '폴더 필요' }}</small></span></button>
        <button type="button" :disabled="!hasFolder" @click="openLLMCompare"><b>3</b><span>검수<small>{{ hasFolder ? '문제 확인' : '폴더 필요' }}</small></span></button>
        <button type="button" :class="{ current: mode === 1 }" :disabled="!hasFolder" @click="mode = 1"><b>4</b><span>적용<small>{{ mode === 1 ? '선택됨' : '검수 후 적용' }}</small></span></button>
      </div>
      <ProjectSnapshot v-if="hasFolder" :folder="folderPath" engine="wolf" />

      <div class="wolf-work">
        <section class="wolf-current">
          <p>현재 작업</p>
          <h2 data-harness-current-task>{{ !hasFolder ? '프로젝트 폴더 선택' : mode === 1 ? '번역 적용' : '텍스트 추출' }}</h2>
          <span>{{ !hasFolder ? '게임 폴더를 선택하면 추출과 번역 도구가 활성화됩니다.' : mode === 1 ? '검수를 마친 번역문을 게임에 적용합니다.' : '현재 지원되는 맵 이벤트 대사를 추출합니다.' }}</span>
          <button v-if="!hasFolder" type="button" class="btn-run" data-harness-primary-action @click="selectFolder">폴더 선택하기</button>
          <button v-else class="btn-run" data-harness-primary-action :disabled="!canRun" :title="runButtonTitle" @click="run">{{ running ? '작업 진행 중' : mode === 1 ? '번역 적용 시작' : '텍스트 추출 시작' }}</button>
          <button v-if="hasFolder" type="button" class="wolf-review" @click="openLLMCompare">번역 비교 열기</button>
        </section>
        <aside class="wolf-options">
          <div class="wolf-options-head">
            <div><span>WOLF 지원 상태</span><strong>현재 지원 범위</strong></div>
          </div>
          <div class="wolf-capability-note">
            <p><strong>지원:</strong> 맵 이벤트 대사 추출·번역·적용</p>
            <p><strong>미지원:</strong> DB 데이터, 커먼 이벤트, 자동 줄바꿈</p>
            <p>적용 전 구분자·빈 줄·제어 코드·원본 binary 변경 여부를 검사합니다.</p>
          </div>
        </aside>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { api, useIpcOn } from '../composables/useIpc'
import TitleBar from '../components/TitleBar.vue'
import ProjectSnapshot from '../components/ProjectSnapshot.vue'
import { useProjectSession } from '../composables/useProjectSession'
import { chooseWorkspaceProject, workspaceOperationRunning } from '../composables/useWorkspaceNavigation'
import Swal from 'sweetalert2'

const { folderPath, mode, running } = useProjectSession('wolf')
const hasFolder = computed(() => folderPath.value.trim().length > 0)
const hasMode = computed(() => mode.value === 0 || mode.value === 1)
const canRun = computed(() => hasFolder.value && hasMode.value && !workspaceOperationRunning())
const runButtonTitle = computed(() => {
  if (workspaceOperationRunning()) return '작업이 진행 중입니다'
  if (!hasFolder.value) return '프로젝트 폴더를 먼저 선택하세요'
  if (!hasMode.value) return '추출 또는 적용을 선택하세요'
  return mode.value === 0 ? '추출을 시작합니다' : '적용을 시작합니다'
})

function guardRunning(): boolean {
  if (workspaceOperationRunning()) {
    Swal.fire({ icon: 'error', text: '이미 다른 작업이 시행중입니다!' })
    return true
  }
  return false
}

function selectFolder() {
  void chooseWorkspaceProject('wolf')
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
    api.send('wolf_ext', { folder: folderPath.value, config: {} })
  } else if (mode.value === 1) {
    api.send('wolf_apply', { folder: folderPath.value })
  }
}

function openSettings() {
  if (guardRunning()) return
  api.send('settings')
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
  api.send('setheight', 700)

  useIpcOn('set_path', (tt: Record<string, string>) => {
    if (tt && tt.type === 'wolf_folder_input') {
      folderPath.value = tt.dir
      if (mode.value === -1) mode.value = 0
    }
  })



  useIpcOn('alert2', async () => {
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

  useIpcOn('alertExten', async (arg: unknown) => {
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
.wolf-capability-note { margin-top: 14px; padding: 14px; border: var(--border); border-radius: 7px; background: rgba(255,255,255,.02); }
.wolf-capability-note p { margin: 0 0 10px; color: var(--muted); font-size: 12px; line-height: 1.55; }
.wolf-capability-note p:last-child { margin-bottom: 0; color: var(--subtle); }
.wolf-capability-note strong { color: var(--mainColor); }

.console-body, .wolf-body { overflow-y: auto; padding-bottom: 56px; }
.pipeline, .wolf-pipeline { flex-shrink: 0; }
.work-grid, .wolf-work { flex: none; }
@media (max-width: 680px) {
  .work-grid, .wolf-work { grid-template-columns: 1fr; }
  .current-task, .wolf-current { border-right: 0; border-bottom: var(--border); }
}
</style>
