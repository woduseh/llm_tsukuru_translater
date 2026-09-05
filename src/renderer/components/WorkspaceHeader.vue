<template>
  <header class="workspace-header" data-harness-workspace-shell>
    <div class="project-line">
      <button type="button" class="home-link" @click="navigate('/')">프로젝트</button>
      <div class="project-identity">
        <strong>{{ projectName }}</strong><span>{{ activeProject.engine === 'wolf' ? 'Wolf RPG' : 'RPG Maker MV / MZ' }}</span>
        <small :title="activeProject.path">{{ activeProject.path }}</small>
      </div>
      <button type="button" class="change-project" :disabled="workspaceOperationRunning()" @click="chooseWorkspaceProject(activeProject.engine as ProjectEngine)">프로젝트 변경</button>
    </div>
    <nav class="workspace-tabs" aria-label="프로젝트 작업">
      <button v-for="tab in tabs" :key="tab.path" type="button" :class="{ active: isActive(tab.path) }"
        :aria-current="isActive(tab.path) ? 'page' : undefined" :data-workspace-tab="tab.id" @click="navigate(tab.path)">
        {{ tab.label }}<span v-if="tab.badge">{{ tab.badge }}</span>
      </button>
    </nav>
    <div v-if="isReview" class="review-navigation">
      <nav aria-label="검수 유형">
        <button type="button" :aria-current="route.path === '/llm-compare' ? 'page' : undefined" :class="{ active: route.path === '/llm-compare' }" data-workspace-review="text" @click="navigate('/llm-compare')">
          번역 대조 <span>{{ reviewWorkspace.text.loaded ? `${reviewWorkspace.text.mismatchCount} 불일치 · ${reviewWorkspace.text.untranslatedCount} 미번역` : '미확인' }}</span>
        </button>
        <button v-if="activeProject.engine !== 'wolf'" type="button" :aria-current="route.path === '/json-verify' ? 'page' : undefined" :class="{ active: route.path === '/json-verify' }" data-workspace-review="structure" @click="navigate('/json-verify')">
          JSON 구조 <span>{{ reviewWorkspace.structure.loaded ? `${reviewWorkspace.structure.issueCount}개 문제` : '미확인' }}</span>
        </button>
      </nav>
      <span class="focused-file">{{ reviewWorkspace.focusedFile || '검수할 파일을 선택하세요' }}</span>
      <button v-if="reviewWorkspace.focusedFile" type="button" class="context-action" @click="navigate('/agent-workspace')">AI 검토 준비</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../composables/useIpc'
import { activeProject, type ProjectEngine } from '../composables/useProjectSession'
import { reviewWorkspace } from '../composables/useReviewWorkspace'
import { workspaceDrafts } from '../composables/useWorkspaceDrafts'
import { chooseWorkspaceProject, workspaceOperationRunning } from '../composables/useWorkspaceNavigation'

const route = useRoute()
const router = useRouter()
const isReview = computed(() => ['/llm-compare', '/json-verify'].includes(route.path))
const projectName = computed(() => {
  const parts = activeProject.path.replaceAll('\\', '/').split('/').filter(Boolean)
  if (activeProject.engine === 'mvmz' && parts.at(-1)?.toLowerCase() === 'data') {
    parts.pop()
    if (parts.at(-1)?.toLowerCase() === 'www') parts.pop()
  }
  return parts.at(-1) || activeProject.path
})
const tabs = computed(() => [
  { id: 'overview', path: '/' + activeProject.engine, label: '추출 · 적용', badge: '' },
  { id: 'translation', path: '/llm-settings', label: '번역', badge: workspaceDrafts.translationDirty ? '초안' : '' },
  { id: 'review', path: '/llm-compare', label: '검수', badge: reviewWorkspace.text.dirty ? '미저장' : '' },
  { id: 'agent', path: '/agent-workspace', label: 'AI 도구', badge: '' },
  { id: 'settings', path: '/settings', label: '설정', badge: workspaceDrafts.settingsDirty ? '미저장' : '' },
])
function isActive(path: string) { return path === '/llm-compare' ? isReview.value : route.path === path }
function navigate(path: string) {
  if (path === route.path) return
  if (path === '/llm-settings') api.send('openLLMSettings', { dir: activeProject.path, game: activeProject.engine })
  else if (path === '/llm-compare') api.send('openLLMCompare', activeProject.path)
  else if (path === '/json-verify') api.send('openJsonVerify', activeProject.path)
  else if (path === '/settings') api.send('settings')
  else void router.push(path)
}
</script>

<style scoped>
.workspace-header { flex-shrink: 0; background: var(--Highlight2); border-bottom: var(--border); }
.project-line { display: flex; align-items: center; gap: 14px; padding: 12px 18px; }
.project-identity { display: flex; flex-wrap: wrap; gap: 3px 12px; flex: 1; min-width: 0; }
.project-identity strong { font-size: 16px; }
.project-identity span { color: var(--muted); font-size: 12px; align-self: center; }
.project-identity small { width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); }
button { border: var(--border); border-radius: 5px; background: transparent; padding: 7px 11px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
.home-link { color: var(--muted); border: 0; }
.change-project { flex-shrink: 0; }
.workspace-tabs { display: flex; gap: 5px; padding: 0 18px; overflow-x: auto; }
.workspace-tabs button { border: 0; border-radius: 0; padding: 10px 16px; border-bottom: 3px solid transparent; white-space: nowrap; color: var(--muted); }
.workspace-tabs button.active { border-color: var(--Accent); color: var(--mainColor); background: var(--Highlight1); font-weight: 700; }
.workspace-tabs span { margin-left: 7px; font-size: 11px; color: var(--Accent); }
.review-navigation { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 18px; background: var(--Background); border-top: var(--border); }
.review-navigation nav { display: flex; gap: 6px; }
.review-navigation button.active { border-color: var(--Healthy); background: var(--Highlight1); }
.review-navigation button span { color: var(--muted); font-size: 11px; margin-left: 6px; }
.focused-file { flex: 1; font-size: 12px; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.context-action { font-size: 12px; }
</style>
