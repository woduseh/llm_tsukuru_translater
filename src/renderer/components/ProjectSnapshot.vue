<template>
  <section class="project-snapshot" aria-label="프로젝트 파일 상태" data-harness-project-snapshot>
    <div class="snapshot-heading">
      <strong>프로젝트 파일 상태</strong>
      <button type="button" @click="refresh">새로고침</button>
    </div>
    <p role="status">{{ message }}</p>
    <p class="snapshot-note">파일 존재 여부를 확인한 상태예요. 번역 품질과 적용 가능 여부는 검수에서 확인하세요.</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useIpcOn } from '../composables/useIpc'
import type { ProjectEngine } from '../composables/useProjectSession'

const props = defineProps<{ folder: string; engine: ProjectEngine }>()
const message = ref('')
function refresh() {
  if (!props.folder) { message.value = '프로젝트 폴더를 선택하면 추출 파일 상태를 확인할 수 있어요.'; return }
  try {
    const root = window.nodePath.join(props.folder, props.engine === 'wolf' ? '_Extract' : 'Extract')
    if (!window.nodeFs.existsSync(root)) { message.value = '추출 폴더 없음 · 먼저 텍스트를 추출하세요.'; return }
    const count = window.nodeFs.readdirSync(root).filter(name => name.toLowerCase().endsWith('.txt')).length
    message.value = count ? `추출 텍스트 ${count}개 파일 · 번역 및 검수 도구에서 내용을 확인하세요.` : '추출 폴더 있음 · 최상위 텍스트 파일 없음'
  } catch {
    message.value = '파일 상태를 읽지 못했어요. 폴더를 다시 선택하거나 새로고침하세요.'
  }
}
watch(() => props.folder, refresh)
useIpcOn('worked', refresh)
onMounted(() => { refresh(); window.addEventListener('focus', refresh) })
onUnmounted(() => window.removeEventListener('focus', refresh))
</script>

<style scoped>
.project-snapshot { margin: 16px 18px 0; padding: 14px 16px; border: var(--border); border-radius: 8px; background: var(--Highlight1); }
.snapshot-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.snapshot-heading button { padding: 5px 9px; background: transparent; border: var(--border); border-radius: 5px; cursor: pointer; }
.project-snapshot p { margin-top: 8px; font-size: 13px; }
.snapshot-note { color: var(--muted); font-size: 12px !important; }
</style>
