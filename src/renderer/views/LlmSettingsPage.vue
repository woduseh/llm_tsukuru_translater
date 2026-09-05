<template>
  <div id="container" data-harness-view="llm-settings" :data-llm-ready="llmReady ? 'true' : 'false'" :data-provider="currentProvider">
    <p class="window-eyebrow">TRANSLATION JOB</p>
    <h2>번역</h2>
    <p class="intro">사용할 번역 설정과 실행 범위를 확인하세요.</p>

    <section class="job-summary" aria-label="번역 설정 요약" data-harness-job-summary>
      <div class="summary-heading">
        <h3>이번 번역에 사용할 설정</h3>
        <span class="ready-state" :class="{ ready: llmReady }">{{ llmReady ? '설정 준비됨' : '설정 확인 필요' }}</span>
      </div>
      <dl class="summary-grid">
        <div><dt>언어</dt><dd>{{ languageLabel(sourceLang) }} → {{ languageLabel(targetLang) }}</dd></div>
        <div><dt>제공자</dt><dd>{{ providerName }}</dd></div>
        <div class="model-summary"><dt>모델</dt><dd>{{ currentModel || '설정 확인 필요' }}</dd></div>
      </dl>
      <details class="prompt-details">
        <summary>현재 사용자 지침 <span>{{ currentPromptCharCount ? `${currentPromptCharCount}자` : '추가 지침 없음' }}</span></summary>
        <pre v-if="currentCustomPrompt" class="current-prompt">{{ currentCustomPrompt }}</pre>
        <p v-else class="field-hint">별도 사용자 지침 없이 기본 번역 프롬프트를 사용해요.</p>
      </details>
      <p class="field-hint">언어·모델·사용자 지침은 앱 설정에서 변경할 수 있어요.</p>
    </section>

    <section class="execution-scope" aria-label="번역 실행 범위">
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

    </section>
    <details class="disclosure-panel" :open="advancedOpen" @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open">
      <summary>고급 실행 설정 <span>{{ parallelWorkers }}개 동시 요청 · {{ requestsPerMinute === 0 ? 'RPM 제한 없음' : `${requestsPerMinute} RPM` }}</span></summary>
      <div class="disclosure-content">
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
      <label for="parallelWorkers">동시 API 요청 수</label>
      <select id="parallelWorkers" class="select-input" v-model.number="parallelWorkers" aria-describedby="parallelWorkersHint" :aria-invalid="concurrencyError ? 'true' : 'false'">
        <option :value="1">1 (기본)</option>
        <option :value="2">2</option>
        <option :value="3">3</option>
        <option :value="4">4</option>
        <option v-if="savedConcurrencyOption !== undefined" :value="savedConcurrencyOption">{{ savedConcurrencyOption }} (저장된 값)</option>
        <option :value="8">8 (고급)</option>
      </select>
      <p id="parallelWorkersHint" class="field-hint">여러 파일과 청크의 API 요청을 합산한 동시 실행 한도예요.</p>
      <p v-if="currentProvider === 'gemini'" class="field-hint">Gemini Flash latest는 무료 사용 또는 한도를 아직 확인하지 않았다면 1로 시작하세요.</p>
      <p class="field-hint">유료 사용은 2로 시작해 실제 RPM/TPM 여유를 확인한 뒤 4로 늘리세요. 8은 충분히 측정한 뒤 사용하는 고급 설정이에요.</p>
    </div>

    <div class="form-group">
      <label for="requestsPerMinute">분당 API 요청 수 (RPM)</label>
      <input
        id="requestsPerMinute"
        type="number"
        class="select-input"
        v-model.number="requestsPerMinute"
        min="0"
        :max="MAX_TRANSLATION_RPM"
        step="1"
        aria-describedby="requestsPerMinuteHint"
        :aria-invalid="rpmError ? 'true' : 'false'"
      />
      <p id="requestsPerMinuteHint" class="field-hint">0이면 앱의 별도 RPM 속도 제한을 적용하지 않아요. 동시 API 요청 수 제한은 유지돼요.</p>
      <p class="field-hint">{{ currentProvider === 'gemini' ? 'AI Studio' : '제공자 콘솔' }}에 표시된 실제 RPM의 80%를 시작값으로 권장해요. 이 앱이 권장하는 여유폭이며, TPM 한도도 따로 확인하세요.</p>
    </div>
    <p v-if="requestSettingsError" id="requestSettingsError" class="validation-error" role="alert">{{ requestSettingsError }}</p>
      </div>
    </details>

    <details class="guideline-panel disclosure-panel" data-harness-guideline-panel>
      <summary>프로젝트 번역 지침 생성 <span>선택 사항</span></summary>
      <div class="disclosure-content">
      <div class="panel-header">
        <div>
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
      </div>
    </details>

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
import { computed, onMounted, ref, watch } from 'vue'
import Swal from 'sweetalert2'
import { api, useIpcOn } from '../composables/useIpc'
import { getRendererLlmProviderMetadata, getRendererLlmProviderUiText } from '../../types/llmProviderContract'
import { MAX_TRANSLATION_CONCURRENCY, MAX_TRANSLATION_RPM } from '../../ts/libs/translationRequestScheduler'
import type { ProjectTranslationProfile } from '../../ts/libs/projectProfile'

const translationMode = ref('untranslated')
const resetProgress = ref(false)
const sortOrder = ref('name-asc')
const parallelWorkers = ref<number | string>(1)
const requestsPerMinute = ref<number | string>(0)
const llmReady = ref(false)
const currentProvider = ref('gemini')
const currentModel = ref('')
const providerName = computed(() => getRendererLlmProviderMetadata(currentProvider.value).displayName)
const advancedOpen = ref(false)
const sourceLang = ref('ja')
const targetLang = ref('ko')
const providerConfigHint = computed(() => getRendererLlmProviderUiText(currentProvider.value).configHint)
const missingConfigMessage = computed(() => getRendererLlmProviderUiText(currentProvider.value).missingConfigMessage)
const submitted = ref(false)
const feedbackMessage = ref('')
const concurrencyError = computed(() => typeof parallelWorkers.value === 'number'
  && Number.isInteger(parallelWorkers.value) && parallelWorkers.value >= 1 && parallelWorkers.value <= MAX_TRANSLATION_CONCURRENCY
  ? '' : `동시 API 요청 수는 1~${MAX_TRANSLATION_CONCURRENCY} 범위의 정수로 선택하세요.`)
const rpmError = computed(() => typeof requestsPerMinute.value === 'number'
  && Number.isInteger(requestsPerMinute.value) && requestsPerMinute.value >= 0 && requestsPerMinute.value <= MAX_TRANSLATION_RPM
  ? '' : `RPM은 0~${MAX_TRANSLATION_RPM} 범위의 정수로 입력하세요. 0은 별도 RPM 제한 없음이에요.`)
const requestSettingsError = computed(() => concurrencyError.value || rpmError.value)
watch(requestSettingsError, error => { if (error) advancedOpen.value = true })
const savedConcurrencyOption = computed(() => typeof parallelWorkers.value === 'number'
  && !concurrencyError.value && ![1, 2, 3, 4, 8].includes(parallelWorkers.value) ? parallelWorkers.value : undefined)
const startDisabled = computed(() => !llmReady.value || submitted.value || !!requestSettingsError.value)
const startButtonTitle = computed(() => !llmReady.value ? missingConfigMessage.value
  : requestSettingsError.value || '선택한 옵션으로 번역을 시작합니다')

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
  useIpcOn('llmSettings', (arg: unknown) => {
    const s = arg as Record<string, any>
    sortOrder.value = s.llmSortOrder || 'name-asc'
    parallelWorkers.value = s.llmParallelWorkers === undefined ? 1 : s.llmParallelWorkers
    requestsPerMinute.value = s.llmRequestsPerMinute === undefined ? 0 : s.llmRequestsPerMinute
    llmReady.value = !!s.llmReady
    currentProvider.value = typeof s.llmProvider === 'string' ? s.llmProvider : 'gemini'
    currentModel.value = typeof s.llmModel === 'string' ? s.llmModel : ''
    sourceLang.value = typeof s.llmSourceLang === 'string' ? s.llmSourceLang : 'ja'
    targetLang.value = typeof s.llmTargetLang === 'string' ? s.llmTargetLang : 'ko'
    currentCustomPrompt.value = typeof s.llmCustomPrompt === 'string' ? s.llmCustomPrompt : ''
  })
  api.send('llmSettingsReady')
})

function languageLabel(language: string): string {
  const labels: Record<string, string> = {
    ja: '일본어', ko: '한국어', en: '영어', 'zh-CN': '중국어 간체', 'zh-TW': '중국어 정체',
    fr: '프랑스어', es: '스페인어', ru: '러시아어', de: '독일어', pt: '포르투갈어',
    it: '이탈리아어', th: '태국어', vi: '베트남어', ar: '아랍어', pl: '폴란드어',
    nl: '네덜란드어', tr: '터키어',
  }
  return labels[language] || language
}

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
  if (requestSettingsError.value) return
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
    llmRequestsPerMinute: requestsPerMinute.value,
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
  padding: 22px 26px; flex: 1; overflow-y: auto;
}
.window-eyebrow { color: var(--Healthy); font-size: 11px; font-weight: 900; letter-spacing: 1.1px; }
h2 { font-size: 24px; font-weight: 800; margin: 2px 0 6px; }
h3 { font-size: 15px; margin: 0 0 6px; }
.intro { margin: 0 0 20px; color: var(--muted); font-size: 13px; line-height: 1.6; }
.job-summary { padding: 16px; border: var(--border); border-radius: 10px; background: var(--Highlight1); }
.summary-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.summary-heading h3 { margin: 0; }
.ready-state { padding: 4px 8px; border: var(--border); border-radius: 5px; font-size: 11px; color: var(--muted); }
.ready-state.ready { color: var(--Healthy); }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0; }
.summary-grid > div { min-width: 0; }
.summary-grid dt { color: var(--muted); font-size: 12px; margin-bottom: 5px; }
.summary-grid dd { margin: 0; font-size: 14px; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
.model-summary { grid-column: 1 / -1; }
.prompt-details { padding-top: 12px; border-top: var(--border); }
summary { cursor: pointer; font-size: 13px; font-weight: 700; line-height: 1.6; }
summary span { color: var(--muted); font-size: 12px; font-weight: 400; margin-left: 6px; }
summary:focus-visible, .btn:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--Accent); outline-offset: 3px; }
.current-prompt { margin: 12px 0; max-height: 220px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 13px; line-height: 1.7; }
.execution-scope { margin-top: 22px; }
.disclosure-panel { margin-top: 12px; border: var(--border); border-radius: 8px; background: var(--Highlight1); }
.disclosure-panel > summary { padding: 14px; }
.disclosure-content { padding: 0 14px 14px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; margin-bottom: 5px; color: var(--muted); }
.select-input {
  width: 100%; padding: 9px 11px; box-sizing: border-box;
  background: var(--Highlight3); border: var(--border); border-radius: 6px;
  color: var(--mainColor); font-size: 13px;
}
.select-input.compact { width: auto; min-width: 210px; }
.checkbox-group label {
  display: flex; align-items: flex-start; gap: 8px; cursor: pointer; color: var(--mainColor); line-height: 1.5;
}
.checkbox-group input { margin-top: 3px; }
.checkbox-group .hint { display: block; margin-top: 3px; }
.hint { font-size: 12px; color: var(--subtle); }
.field-hint { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
.validation-error { margin: 8px 0 14px; font-size: 12px; color: var(--Danger, #ff9b9b); }
.config-hint { font-size: 12px; color: var(--muted); margin-top: 16px; }
.warning { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
.guideline-actions {
  display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
}
.profile-preview {
  margin-top: 10px; padding: 10px; border-radius: 6px; background: #18252b;
  display: flex; flex-direction: column; gap: 4px; font-size: 12px;
}
.prompt-note { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.textarea-label { display: block; margin-top: 12px; margin-bottom: 6px; font-size: 12px; color: var(--muted); }
.guideline-textarea {
  width: 100%; min-height: 180px; resize: vertical; box-sizing: border-box;
  background: var(--Highlight3); border: var(--border); border-radius: 6px;
  color: var(--mainColor); padding: 10px; font-size: 12px; line-height: 1.5; font-family: inherit;
}
.merge-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px;
  font-size: 12px;
}
.button-bar {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 24px; border-top: var(--border); background: #0c1216;
}
.btn {
  padding: 9px 20px; border-radius: 6px; font-size: 13px; font-weight: 700;
  font-family: inherit; cursor: pointer; transition: var(--transition);
  background: var(--Highlight1); border: var(--border); color: var(--mainColor);
}
.btn.small { padding: 7px 12px; font-size: 12px; }
.btn.primary {
  background: var(--Accent);
  border: 1px solid #ffc24e; color: #12181b; font-weight: 900;
}
.btn.primary:hover:not(:disabled) { background: var(--AccentHover); }
.btn:disabled { opacity: 0.45; cursor: default; filter: grayscale(0.2); }
@media (max-width: 420px) {
  #container { padding: 18px 14px; }
  .summary-grid { grid-template-columns: 1fr; }
  .select-input.compact { width: 100%; min-width: 0; }
  .button-bar { padding: 12px 14px; }
  .disclosure-panel > summary span { display: block; margin-left: 16px; }
}
</style>
