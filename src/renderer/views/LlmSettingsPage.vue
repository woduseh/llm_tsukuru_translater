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

    <div class="form-group">
      <label for="parallelWorkers">동시 번역 파일 수</label>
      <select id="parallelWorkers" class="select-input" v-model.number="parallelWorkers">
        <option :value="1">1 (기본, 가장 안전)</option>
        <option :value="2">2</option>
        <option :value="3">3</option>
        <option :value="4">4</option>
      </select>
    </div>

    <section class="guideline-panel" data-harness-guideline-panel>
      <div class="panel-header">
        <div>
          <h3>프로젝트 번역 지침 생성</h3>
          <p class="warning">
            스캔한 요약 프로필(용어/이름/패턴 일부)만 현재 LLM 제공자에 전송합니다.
            API 비용이 발생할 수 있으며, 생성 후 반드시 미리보기와 편집을 거쳐 반영하세요.
          </p>
        </div>
      </div>

      <div class="guideline-actions">
        <button class="btn small" :disabled="scanBusy || generateBusy" @click="scanProfile">
          {{ scanBusy ? '스캔 중...' : '1. 프로필 스캔' }}
        </button>
        <button class="btn small" :disabled="!profile || !llmReady || scanBusy || generateBusy" @click="generateGuideline">
          {{ generateBusy ? '생성 중...' : '2. 지침 생성' }}
        </button>
        <button class="btn small" :disabled="!generateBusy" @click="cancelGuideline">
          생성 취소
        </button>
      </div>

      <div v-if="profileSummary" class="profile-preview" data-harness-guideline-profile>
        <strong>프로필 미리보기</strong>
        <span>{{ profileSummary }}</span>
      </div>
      <p class="prompt-note">현재 사용자 프롬프트: {{ currentPromptCharCount }}자. 아래 초안은 자동 반영되지 않습니다.</p>

      <label class="textarea-label" for="guidelineDraft">지침 미리보기 / 편집</label>
      <textarea
        id="guidelineDraft"
        class="guideline-textarea"
        v-model="guidelineDraft"
        placeholder="프로필 스캔 후 지침 생성을 누르면 여기에 초안이 표시됩니다."
        data-harness-guideline-draft
      ></textarea>

      <div class="merge-row">
        <label for="guidelineMergeMode">반영 방식</label>
        <select id="guidelineMergeMode" class="select-input compact" v-model="guidelineMergeMode">
          <option value="append">기존 사용자 프롬프트 뒤에 추가</option>
          <option value="replace">사용자 프롬프트를 이 지침으로 교체</option>
        </select>
        <button class="btn small primary" :disabled="!guidelineDraft.trim() || applyBusy" @click="applyGuideline">
          {{ applyBusy ? '반영 중...' : '3. 프롬프트에 반영' }}
        </button>
      </div>
    </section>

    <p id="providerConfigHint" class="config-hint" role="status">{{ feedbackMessage || providerConfigHint }}</p>
  </div>

  <div class="button-bar">
    <button class="btn" @click="cancel">취소</button>
    <button
      class="btn primary"
      :disabled="startDisabled"
      :aria-disabled="startDisabled ? 'true' : 'false'"
      :title="startButtonTitle"
      @click="start"
    >{{ submitted ? '시작 중...' : '번역 시작' }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Swal from 'sweetalert2'
import { api } from '../composables/useIpc'
import { getRendererLlmProviderUiText } from '../../types/llmProviderContract'
import type { ProjectTranslationProfile } from '../../ts/libs/projectProfile'

const translationMode = ref('untranslated')
const resetProgress = ref(false)
const sortOrder = ref('name-asc')
const parallelWorkers = ref(1)
const llmReady = ref(false)
const currentProvider = ref('gemini')
const sourceLang = ref('ja')
const targetLang = ref('ko')
const providerConfigHint = computed(() => getRendererLlmProviderUiText(currentProvider.value).configHint)
const missingConfigMessage = computed(() => getRendererLlmProviderUiText(currentProvider.value).missingConfigMessage)
const submitted = ref(false)
const feedbackMessage = ref('')
const startDisabled = computed(() => !llmReady.value || submitted.value)
const startButtonTitle = computed(() => llmReady.value ? '선택한 옵션으로 번역을 시작합니다' : missingConfigMessage.value)

const profile = ref<ProjectTranslationProfile | null>(null)
const guidelineDraft = ref('')
const currentCustomPrompt = ref('')
const guidelineMergeMode = ref<'append' | 'replace'>('append')
const scanBusy = ref(false)
const generateBusy = ref(false)
const applyBusy = ref(false)

const profileSummary = computed(() => {
  if (!profile.value) return ''
  const p = profile.value
  return [
    `파일 ${p.fileStats.scannedFiles}/${p.fileStats.totalFiles}개 스캔`,
    `이름 ${p.names.length}개`,
    `용어 ${p.terms.length}개`,
    `반복 문구 ${p.repeatedPhrases.length}개`,
    `제어 코드 패턴 ${p.controlCodePatterns.length}개`,
    `구분자 패턴 ${p.separatorPatterns.length}개`,
    `언어 ${sourceLang.value} → ${targetLang.value}`,
  ].join(' · ')
})
const currentPromptCharCount = computed(() => currentCustomPrompt.value.length)

onMounted(() => {
  api.on('llmSettings', (arg: unknown) => {
    const s = arg as Record<string, any>
    sortOrder.value = s.llmSortOrder || 'name-asc'
    parallelWorkers.value = Number.isInteger(s.llmParallelWorkers) ? s.llmParallelWorkers : 1
    llmReady.value = !!s.llmReady
    currentProvider.value = typeof s.llmProvider === 'string' ? s.llmProvider : 'gemini'
    sourceLang.value = typeof s.llmSourceLang === 'string' ? s.llmSourceLang : 'ja'
    targetLang.value = typeof s.llmTargetLang === 'string' ? s.llmTargetLang : 'ko'
    currentCustomPrompt.value = typeof s.llmCustomPrompt === 'string' ? s.llmCustomPrompt : ''
    if (s.themeData) {
      const root = document.documentElement
      for (const [key, val] of Object.entries(s.themeData as Record<string, string>)) {
        root.style.setProperty(key, val)
      }
    }
  })
  api.send('llmSettingsReady')
})

async function scanProfile() {
  if (scanBusy.value) return
  scanBusy.value = true
  feedbackMessage.value = '프로젝트 프로필을 스캔하는 중입니다...'
  try {
    profile.value = await api.invoke('scanGuidelineProfile') as ProjectTranslationProfile
    feedbackMessage.value = '프로필 스캔이 완료되었습니다. 지침 생성을 눌러 초안을 만들 수 있습니다.'
  } catch (error) {
    feedbackMessage.value = getErrorMessage(error)
    await showError('프로필 스캔 실패', feedbackMessage.value)
  } finally {
    scanBusy.value = false
  }
}

async function generateGuideline() {
  if (generateBusy.value || !profile.value) return
  if (!llmReady.value) {
    feedbackMessage.value = missingConfigMessage.value
    await showError('LLM 설정이 필요합니다', missingConfigMessage.value)
    return
  }
  generateBusy.value = true
  feedbackMessage.value = '현재 LLM 제공자로 번역 지침을 생성하는 중입니다...'
  try {
    const result = await api.invoke('generateGuidelineDraft', { profile: profile.value }) as {
      guideline?: string
      promptChars?: number
    }
    guidelineDraft.value = result.guideline || ''
    feedbackMessage.value = `지침 초안이 생성되었습니다. 전송 프롬프트 약 ${result.promptChars || 0}자.`
  } catch (error) {
    feedbackMessage.value = getErrorMessage(error)
    await showError('지침 생성 실패', feedbackMessage.value)
  } finally {
    generateBusy.value = false
  }
}

function cancelGuideline() {
  api.send('cancelGuidelineGeneration')
  feedbackMessage.value = '지침 생성 취소를 요청했습니다.'
}

async function applyGuideline() {
  if (applyBusy.value || !guidelineDraft.value.trim()) return
  applyBusy.value = true
  feedbackMessage.value = '사용자 프롬프트에 지침을 반영하는 중입니다...'
  try {
    const result = await api.invoke('applyGuidelineDraft', {
      guideline: guidelineDraft.value,
      mode: guidelineMergeMode.value,
    }) as { llmCustomPrompt?: string }
    currentCustomPrompt.value = result.llmCustomPrompt || currentCustomPrompt.value
    feedbackMessage.value = '번역 지침이 사용자 프롬프트에 반영되었습니다.'
    await Swal.fire({
      icon: 'success',
      title: '반영 완료',
      text: '설정 저장소의 LLM 사용자 프롬프트가 업데이트되었습니다.',
      confirmButtonText: '확인',
      background: 'var(--Highlight1)',
      color: 'var(--mainColor)',
    })
  } catch (error) {
    feedbackMessage.value = getErrorMessage(error)
    await showError('지침 반영 실패', feedbackMessage.value)
  } finally {
    applyBusy.value = false
  }
}

function start() {
  if (submitted.value) return
  if (!llmReady.value) {
    feedbackMessage.value = missingConfigMessage.value
    Swal.fire({
      icon: 'warning',
      title: '번역 설정이 필요합니다',
      text: missingConfigMessage.value,
      confirmButtonText: '확인',
      background: 'var(--Highlight1)',
      color: 'var(--mainColor)',
    })
    return
  }
  submitted.value = true
  feedbackMessage.value = '번역 작업을 시작하는 중입니다...'
  api.send('llmSettingsApply', {
    llmResetProgress: resetProgress.value,
    llmSortOrder: sortOrder.value,
    llmParallelWorkers: parallelWorkers.value,
    llmTranslationMode: translationMode.value,
  })
}

function cancel() {
  if (generateBusy.value) api.send('cancelGuidelineGeneration')
  api.send('llmSettingsClose')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function showError(title: string, text: string) {
  return Swal.fire({
    icon: 'error',
    title,
    text,
    confirmButtonText: '확인',
    background: 'var(--Highlight1)',
    color: 'var(--mainColor)',
  })
}
</script>

<style scoped>
#container {
  padding: 20px 24px; flex: 1; overflow-y: auto;
}
h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
h3 { font-size: 15px; margin: 0 0 6px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; margin-bottom: 4px; opacity: 0.7; }
.select-input {
  width: 100%; padding: 8px 10px;
  background: var(--Highlight1); border: var(--border); border-radius: 6px;
  color: var(--mainColor); font-size: 13px; font-family: inherit;
}
.select-input.compact { width: auto; min-width: 210px; }
.checkbox-group label {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
}
.hint { font-size: 11px; opacity: 0.4; }
.config-hint { font-size: 12px; opacity: 0.55; margin-top: 16px; }
.guideline-panel {
  margin-top: 18px; padding: 14px; border: var(--border); border-radius: 12px;
  background: rgba(255,255,255,0.03);
}
.warning { margin: 0; font-size: 12px; line-height: 1.45; opacity: 0.65; }
.guideline-actions {
  display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
}
.profile-preview {
  margin-top: 10px; padding: 10px; border-radius: 8px; background: var(--Highlight1);
  display: flex; flex-direction: column; gap: 4px; font-size: 12px;
}
.prompt-note { margin: 10px 0 0; font-size: 12px; opacity: 0.55; }
.textarea-label { display: block; margin-top: 12px; margin-bottom: 6px; font-size: 12px; opacity: 0.7; }
.guideline-textarea {
  width: 100%; min-height: 180px; resize: vertical; box-sizing: border-box;
  background: var(--Highlight1); border: var(--border); border-radius: 8px;
  color: var(--mainColor); padding: 10px; font-size: 12px; line-height: 1.5; font-family: inherit;
}
.merge-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px;
  font-size: 12px;
}
.button-bar {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 24px; border-top: 1px solid rgba(255,255,255,0.06);
}
.btn {
  padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: var(--transition);
  background: var(--Highlight1); border: var(--border); color: var(--mainColor);
}
.btn.small { padding: 7px 12px; font-size: 12px; }
.btn.primary {
  background: linear-gradient(135deg, var(--accent), #6c5ce7);
  border: none; color: #fff;
}
.btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
.btn:disabled { opacity: 0.45; cursor: default; filter: grayscale(0.2); }
</style>
