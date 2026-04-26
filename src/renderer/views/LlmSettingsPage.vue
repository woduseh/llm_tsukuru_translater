<template>
  <div id="container" data-harness-view="llm-settings" :data-llm-ready="llmReady ? 'true' : 'false'" :data-provider="currentProvider">
    <h2>번역</h2>

    <div class="form-group">
      <label for="translationMode">번역 범위</label>
      <select id="translationMode" class="select-input" v-model="translationMode">
        <option value="untranslated">미번역 파일만</option>
        <option value="all">전체 번역</option>
      </select>
    </div>

    <div class="form-group checkbox-group">
      <label>
        <input type="checkbox" v-model="resetProgress" />
        <span>처음부터 번역 <span class="hint">이전 진행 상태와 캐시를 삭제하고 백업에서 원본을 복원합니다</span></span>
      </label>
    </div>

    <div class="form-group">
      <label for="sortOrder">번역 순서</label>
      <select id="sortOrder" class="select-input" v-model="sortOrder">
        <option value="name-asc">이름순 (오름차순)</option>
        <option value="name-desc">이름순 (내림차순)</option>
        <option value="size-asc">크기순 (작은 파일 먼저)</option>
        <option value="size-desc">크기순 (큰 파일 먼저)</option>
      </select>
    </div>

    <p class="config-hint">{{ providerConfigHint }}</p>
  </div>

  <div class="button-bar">
    <button class="btn" @click="cancel">취소</button>
    <button class="btn primary" @click="start">번역 시작</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../composables/useIpc'
import {
  getLlmProviderConfigHint,
  getLlmProviderMissingConfigMessage,
} from '../../ts/libs/llmProviderConfig'

const translationMode = ref('untranslated')
const resetProgress = ref(false)
const sortOrder = ref('name-asc')
const llmReady = ref(false)
const currentProvider = ref('gemini')
const providerConfigHint = computed(() => getLlmProviderConfigHint(currentProvider.value))
const missingConfigMessage = computed(() => getLlmProviderMissingConfigMessage(currentProvider.value))

onMounted(() => {
  api.on('llmSettings', (arg: unknown) => {
    const s = arg as Record<string, any>
    sortOrder.value = s.llmSortOrder || 'name-asc'
    llmReady.value = !!s.llmReady
    currentProvider.value = typeof s.llmProvider === 'string' ? s.llmProvider : 'gemini'
    if (s.themeData) {
      const root = document.documentElement
      for (const [key, val] of Object.entries(s.themeData as Record<string, string>)) {
        root.style.setProperty(key, val)
      }
    }
  })
  api.send('llmSettingsReady')
})

function start() {
  if (!llmReady.value) {
    alert(missingConfigMessage.value)
    return
  }
  api.send('llmSettingsApply', {
    llmResetProgress: resetProgress.value,
    llmSortOrder: sortOrder.value,
    llmTranslationMode: translationMode.value,
  })
}

function cancel() {
  api.send('llmSettingsClose')
}
</script>

<style scoped>
#container {
  padding: 20px 24px; flex: 1;
}
h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; margin-bottom: 4px; opacity: 0.7; }
.select-input {
  width: 100%; padding: 8px 10px;
  background: var(--Highlight1); border: var(--border); border-radius: 6px;
  color: var(--mainColor); font-size: 13px; font-family: inherit;
}
.checkbox-group label {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
}
.hint { font-size: 11px; opacity: 0.4; }
.config-hint { font-size: 12px; opacity: 0.4; margin-top: 16px; }
.button-bar {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 24px; border-top: 1px solid rgba(255,255,255,0.06);
}
.btn {
  padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: var(--transition);
  background: var(--Highlight1); border: var(--border); color: var(--mainColor);
}
.btn.primary {
  background: linear-gradient(135deg, var(--accent), #6c5ce7);
  border: none; color: #fff;
}
.btn.primary:hover { filter: brightness(1.1); }
</style>
