<template>
  <div class="app-root">
    <router-view />
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
    <AgentTerminalDrawer v-if="showGlobalTerminalDrawer" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AgentTerminalDrawer from './components/AgentTerminalDrawer.vue'
import { useIpcOn } from './composables/useIpc'
import { useMutationApprovals } from './composables/useMutationApprovals'
import Swal from 'sweetalert2'
import { AGENT_WORKSPACE_ROUTE } from './agentWorkspaceModel'

const route = useRoute()
const router = useRouter()
const { pendingApprovals, pendingCount } = useMutationApprovals()
const terminalDrawerRoutes = new Set(['/', '/mvmz', '/wolf'])
const showGlobalTerminalDrawer = computed(() => terminalDrawerRoutes.has(route.path))
const showApprovalBanner = computed(() => route.path !== AGENT_WORKSPACE_ROUTE && pendingCount.value > 0)

for (const channel of ['getGlobalSettings', 'settings', 'llmSettings', 'verifySettings']) {
  useIpcOn(channel, (settings: Record<string, unknown>) => {
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
