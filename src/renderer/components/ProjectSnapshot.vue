<template>
  <section class="project-snapshot" aria-label="프로젝트 파일 상태" data-harness-project-snapshot>
    <strong>프로젝트 파일 상태</strong>
    <p role="status">{{ message }}</p>
    <button v-if="readFailed" type="button" @click="refresh">다시 시도</button>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useIpcOn } from '../composables/useIpc'
import type { ProjectEngine } from '../composables/useProjectSession'

const props = defineProps<{ folder: string; engine: ProjectEngine }>()
const message = ref('')
const readFailed = ref(false)
function refresh() {
  readFailed.value = false
  if (!props.folder) { message.value = '프로젝트 폴더를 선택하면 추출 파일 상태를 확인할 수 있어요.'; return }
  try {
    const root = props.engine === 'wolf'
      ? window.nodePath.join(props.folder, '_Extract', 'Texts')
      : window.nodePath.join(props.folder, 'Extract')
    if (!window.nodeFs.existsSync(root)) { message.value = '추출 폴더가 없어요. 먼저 텍스트를 추출하세요.'; return }
    const count = window.nodeFs.readdirSync(root).filter(name => name.toLowerCase().endsWith('.txt')).length
    message.value = count ? `추출 텍스트 ${count}개 파일이 있어요.` : '추출 폴더에 텍스트 파일이 없어요.'
  } catch {
    readFailed.value = true
    message.value = '파일 상태를 읽지 못했어요.'
  }
}
watch(() => props.folder, refresh)
useIpcOn('worked', refresh)
onMounted(() => { refresh(); window.addEventListener('focus', refresh) })
onUnmounted(() => window.removeEventListener('focus', refresh))
</script>

<style scoped>
.project-snapshot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin: 16px 18px 0; padding: 12px 16px; border: var(--border); border-radius: 8px; background: var(--Highlight1); }
.project-snapshot p { flex: 1; min-width: 0; font-size: 14px; }
.project-snapshot button { padding: 6px 10px; background: transparent; border: var(--border); border-radius: 6px; cursor: pointer; }
</style>
