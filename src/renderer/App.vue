<template>
  <div class="app-root" :class="{ 'workspace-active': showWorkspace }">
    <TitleBar v-if="mainRenderer" :show-abort-btn="true"
      :show-settings="!showWorkspace && ['/mvmz', '/wolf', '/agent-workspace'].includes(route.path)" @settings="api.send('settings')" />
    <WorkspaceHeader v-if="showWorkspace" />
    <div class="workspace-content" :class="{ embedded: showWorkspace, 'main-surface': mainRenderer }">
      <router-view v-slot="{ Component }">
        <KeepAlive :key="activeProject.path" :max="8">
          <component :is="Component" v-bind="toolProps" />
        </KeepAlive>
      </router-view>
    </div>
    <footer v-if="showWorkspace" class="workspace-status" role="status" aria-live="polite">
      <span>{{ activityText }}</span>
      <progress v-if="workspaceActivity.translating || projectBusy" :value="workspaceActivity.progress" max="100" aria-label="현재 작업 진행률" />
      <span>{{ reviewWorkspace.text.dirty ? '번역 편집 미저장 · 탭을 이동해도 유지돼요' : '현재 프로젝트 안에서 작업 중' }}</span>
    </footer>
    <button
      v-if="showApprovalBanner"
      type="button"
      class="approval-banner"
      data-harness-approval-banner
      :data-pending-count="pendingCount"
      aria-live="polite"
      @click="openApprovalQueue"
    >
      <span class="approval-count">{{ pendingCount }}</span>
      <span>
        <strong>변경 승인 대기</strong>
        <small>AI 작업공간에서 내용을 검토하세요</small>
      </span>
      <span aria-hidden="true">→</span>
    </button>
    <AgentTerminalDrawer v-if="showGlobalTerminalDrawer" :docked="showWorkspace" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AgentTerminalDrawer from './components/AgentTerminalDrawer.vue'
import { api, useIpcOn } from './composables/useIpc'
import { useMutationApprovals } from './composables/useMutationApprovals'
import Swal from 'sweetalert2'
import { AGENT_WORKSPACE_ROUTE } from './agentWorkspaceModel'
import { activeProject, projectBusy, useProjectSession } from './composables/useProjectSession'
import { reviewWorkspace, resetReviewWorkspace } from './composables/useReviewWorkspace'
import { workspaceActivity } from './composables/useWorkspaceNavigation'
import WorkspaceHeader from './components/WorkspaceHeader.vue'
import TitleBar from './components/TitleBar.vue'

useIpcOn('worked', () => { if (!workspaceActivity.translating) projectBusy.value = false })

const route = useRoute()
const router = useRouter()
const mainRenderer = ref(route.path === '/')
const toolRoutes = new Set(['/llm-settings', '/llm-compare', '/json-verify', '/settings'])
const workspaceRoutes = new Set(['/mvmz', '/wolf', '/agent-workspace', ...toolRoutes])
const showWorkspace = computed(() => mainRenderer.value && !!activeProject.path && workspaceRoutes.has(route.path)
  && (!['/mvmz', '/wolf'].includes(route.path) || route.path === '/' + activeProject.engine))
const toolProps = computed(() => toolRoutes.has(route.path) ? { embedded: mainRenderer.value } : {})
const returnRoutes = new Map<string, string>()
const activityText = computed(() => {
  if (workspaceActivity.translating || projectBusy.value) return `${workspaceActivity.label || '작업 진행 중'} · ${Math.round(workspaceActivity.progress)}%`
  if (reviewWorkspace.text.busy || reviewWorkspace.structure.busy) return '검수 작업 진행 중'
  return '대기 중'
})

useIpcOn('loading', (value: number) => { workspaceActivity.progress = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0 })
useIpcOn('loadingTag', (value: string) => { workspaceActivity.label = value })
useIpcOn('llmTranslating', (value: boolean) => { workspaceActivity.translating = value; projectBusy.value = value })
useIpcOn('workspaceNavigate', (payload: { route?: string }) => {
  const requested = payload?.route
  if (typeof requested !== 'string') return
  mainRenderer.value = true
  const target = requested === 'back' ? returnRoutes.get(route.path) || (activeProject.engine ? '/' + activeProject.engine : '/') : requested
  if (target !== '/' && !workspaceRoutes.has(target)) return
  if (target === route.path) return
  if (requested !== 'back') returnRoutes.set(target, route.path)
  void router.push(target)
})
useIpcOn('set_path', (payload: { type?: string; dir?: string }) => {
  if (!payload?.dir || !['folder_input', 'wolf_folder_input'].includes(payload.type || '')) return
  const engine = payload.type === 'wolf_folder_input' ? 'wolf' : 'mvmz'
  useProjectSession(engine).folderPath.value = payload.dir
  void router.push('/' + engine)
})
watch(() => activeProject.path, (path) => {
  resetReviewWorkspace(path)
  returnRoutes.clear()
})
const { pendingApprovals, pendingCount } = useMutationApprovals()
const terminalDrawerRoutes = new Set(['/', '/mvmz', '/wolf'])
const showGlobalTerminalDrawer = computed(() => terminalDrawerRoutes.has(route.path) || (showWorkspace.value && route.path !== AGENT_WORKSPACE_ROUTE))
const showApprovalBanner = computed(() => route.path !== AGENT_WORKSPACE_ROUTE && pendingCount.value > 0)

for (const channel of ['getGlobalSettings', 'settings', 'llmSettings', 'verifySettings']) {
  useIpcOn(channel, (settings: Record<string, unknown>) => {
    if (channel === 'getGlobalSettings') mainRenderer.value = true
    if (settings && settings.themeData) {
      for (const [key, value] of Object.entries(settings.themeData as Record<string, string>)) {
        document.documentElement.style.setProperty(key, value)
      }
    }
  })
}

function openApprovalQueue() {
  const first = pendingApprovals.value[0]
  if (!first) return
  void router.push({
    path: AGENT_WORKSPACE_ROUTE,
    query: { approval: first.approvalId },
  })
}

useIpcOn('alert', (tt: unknown) => {
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

useIpcOn('alert_free', (tt: unknown) => {
  if (typeof tt === 'string') {
    Swal.fire({ icon: 'info', title: tt })
  }
})
</script>

<style scoped>
.app-root {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.workspace-content { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.workspace-content.main-surface :deep(.titlebar) { display: none; }
.workspace-content.embedded :deep(.console-rail),
.workspace-content.embedded :deep(.wolf-rail),
.workspace-content.embedded :deep(.project-header),
.workspace-content.embedded :deep(.wolf-header) { display: none; }
.workspace-content.embedded :deep(.project-console), .workspace-content.embedded :deep(.wolf-console) { grid-template-columns: 1fr; }
.workspace-content.embedded :deep(.agent-workspace) { height: 100%; min-height: 0; overflow-y: auto; }
.workspace-status { display: flex; align-items: center; gap: 12px; flex-shrink: 0; min-height: 32px; padding: 6px 18px; background: var(--Highlight2); border-top: var(--border); color: var(--muted); font-size: 11px; }
.workspace-status span:last-child { margin-left: auto; margin-right: 150px; }
.workspace-status progress { width: 120px; height: 6px; accent-color: var(--Accent); }
.workspace-active .approval-banner { top: auto; bottom: 42px; }
.approval-banner {
  position: fixed;
  z-index: 90;
  top: 38px;
  right: 12px;
  max-width: min(360px, calc(100vw - 24px));
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  color: var(--mainColor);
  background: rgba(16, 23, 27, 0.97);
  border: 1px solid rgba(255, 190, 92, 0.6);
  border-radius: var(--radius-md);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.approval-banner:hover { border-color: #ffc36a; background: rgba(49, 50, 72, 0.98); }
.approval-banner:focus-visible { outline: 2px solid #ffc36a; outline-offset: 2px; }
.approval-banner > span:nth-child(2) { min-width: 0; flex: 1; }
.approval-banner strong, .approval-banner small { display: block; overflow-wrap: anywhere; }
.approval-banner strong { font-size: 11px; }
.approval-banner small { margin-top: 2px; font-size: 9px; opacity: 0.72; }
.approval-count {
  display: grid;
  place-items: center;
  min-width: 25px;
  height: 25px;
  padding: 0 6px;
  border-radius: 999px;
  color: #171821;
  background: #ffc36a;
  font-size: 12px;
  font-weight: 800;
}
</style>
