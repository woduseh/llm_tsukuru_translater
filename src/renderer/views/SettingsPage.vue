<template>
  <div id="container">
    <!-- General settings -->
    <div class="settings-group">
      <div class="group-title">일반</div>
      <div class="setting-item" v-for="item in generalSettings" :key="item.key">
        <label :for="item.key">{{ item.label }}</label>
        <input type="checkbox" :id="item.key" v-model="settings[item.key]">
      </div>
    </div>

    <!-- LLM Translation Settings -->
    <div class="settings-group">
      <div class="group-title">LLM 번역</div>
      <div class="setting-item">
        <label for="llmProvider">제공자</label>
        <select id="llmProvider" class="text-input" v-model="settings.llmProvider">
          <option value="gemini">Gemini API</option>
          <option value="vertex">Vertex AI</option>
          <option value="openai">OpenAI</option>
          <option value="custom-openai">OpenAI 호환 API</option>
          <option value="claude">Claude</option>
        </select>
      </div>
      <div class="setting-item" v-show="settings.llmProvider === 'gemini'">
        <label for="llmApiKey">Gemini API 키</label>
        <input type="password" id="llmApiKey" class="text-input" v-model="settings.llmApiKey" placeholder="API 키">
      </div>
      <div class="setting-item" v-show="settings.llmProvider === 'openai'">
        <label for="llmOpenAiApiKey">OpenAI API 키</label>
        <input type="password" id="llmOpenAiApiKey" class="text-input" v-model="settings.llmOpenAiApiKey" placeholder="sk-...">
      </div>
      <div class="setting-item" v-show="settings.llmProvider === 'custom-openai'">
        <label for="llmCustomBaseUrl">호환 API Base URL</label>
        <input type="text" id="llmCustomBaseUrl" class="text-input" v-model="settings.llmCustomBaseUrl" placeholder="http://localhost:1234/v1">
      </div>
      <div class="setting-item" v-show="settings.llmProvider === 'custom-openai'">
        <label for="llmCustomApiKey">호환 API 키 <span class="hint">선택</span></label>
        <input type="password" id="llmCustomApiKey" class="text-input" v-model="settings.llmCustomApiKey" placeholder="필요한 경우만 입력">
      </div>
      <div class="setting-item" v-show="settings.llmProvider === 'claude'">
        <label for="llmClaudeApiKey">Claude API 키</label>
        <input type="password" id="llmClaudeApiKey" class="text-input" v-model="settings.llmClaudeApiKey" placeholder="sk-ant-...">
      </div>
      <div class="setting-item multiline" v-show="isVertexProvider">
        <label for="llmVertexServiceAccountJson">Vertex 서비스 계정 JSON</label>
        <textarea
          id="llmVertexServiceAccountJson"
          spellcheck="false"
          v-model="settings.llmVertexServiceAccountJson"
          placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
        ></textarea>
      </div>
      <div class="setting-item" v-show="isVertexProvider">
        <label for="llmVertexLocation">Vertex 위치</label>
        <input
          type="text"
          id="llmVertexLocation"
          class="text-input"
          v-model="settings.llmVertexLocation"
          :placeholder="DEFAULT_LLM_VERTEX_LOCATION"
        >
      </div>
      <div class="setting-item">
        <label for="llmModel">모델</label>
        <input type="text" id="llmModel" class="text-input" list="modelList" v-model="settings.llmModel" placeholder="모델 이름">
        <datalist id="modelList">
          <option v-for="model in modelSuggestions" :key="model" :value="model">{{ model }}</option>
        </datalist>
      </div>
      <div class="setting-item" v-show="settings.llmProvider === 'claude'">
        <label for="llmMaxTokens">최대 토큰</label>
        <input type="number" id="llmMaxTokens" class="text-input short" v-model.number="settings.llmMaxTokens" min="1" max="200000">
      </div>
      <div class="setting-item">
        <label for="llmSourceLang">원문 언어</label>
        <select id="llmSourceLang" class="text-input" v-model="settings.llmSourceLang">
          <option v-for="l in sourceLangs" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>
      <div class="setting-item">
        <label for="llmTargetLang">번역 언어</label>
        <select id="llmTargetLang" class="text-input" v-model="settings.llmTargetLang">
          <option v-for="l in targetLangs" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>
      <div class="setting-item">
        <label for="llmTranslationUnit">번역 단위</label>
        <select id="llmTranslationUnit" class="text-input" v-model="settings.llmTranslationUnit">
          <option value="file">파일 단위</option>
          <option value="chunk">청크 단위</option>
        </select>
      </div>
      <div class="setting-item" v-show="settings.llmTranslationUnit !== 'file'">
        <label for="llmChunkSize">청크 크기</label>
        <input type="number" id="llmChunkSize" class="text-input short" v-model.number="settings.llmChunkSize" min="1" max="200">
      </div>
      <div class="setting-item">
        <label for="llmMaxRetries">검증 재시도 <span class="hint">번역 검증 실패 시</span></label>
        <input type="number" id="llmMaxRetries" class="text-input short" v-model.number="settings.llmMaxRetries" min="0" max="10">
      </div>
      <div class="setting-item">
        <label for="llmMaxApiRetries">API 오류 재시도 <span class="hint">429/503 등</span></label>
        <input type="number" id="llmMaxApiRetries" class="text-input short" v-model.number="settings.llmMaxApiRetries" min="0" max="20">
      </div>
      <div class="setting-item">
        <label for="llmTimeout">API 타임아웃 (초) <span class="hint">큰 파일은 길게 설정</span></label>
        <input type="number" id="llmTimeout" class="text-input short" v-model.number="settings.llmTimeout" min="30" max="3600">
      </div>
      <div class="textarea-label" style="margin-top:8px">추가 지시사항 <span class="hint">번역 스타일, 용어집, 기타 지시</span></div>
      <textarea id="llmCustomPrompt" spellcheck="false" v-model="settings.llmCustomPrompt"
        placeholder="예: 존댓말을 사용하세요&#10;ひかり는 히카리로 번역하세요&#10;판타지 스타일로 번역하세요"></textarea>
      <div class="provider-hint">{{ providerConfigHint }}</div>
    </div>

    <!-- Advanced settings -->
    <details>
      <summary>고급 설정</summary>
      <div class="warn-text">고급 설정 변경 시 번역에 문제가 생길 수 있습니다</div>
      <div class="setting-item" v-for="item in advancedSettings" :key="item.key">
        <label :for="item.key">{{ item.label }}</label>
        <input type="checkbox" :id="item.key" v-model="settings[item.key]">
      </div>

      <div class="settings-group" style="margin-top:12px">
        <div class="textarea-label">추가 추출 코드 <span class="tag">MV/MZ</span></div>
        <textarea id="extractPlus" spellcheck="false" v-model="extractPlusText" placeholder="122&#10;300&#10;.."></textarea>
      </div>

      <div class="setting-item">
        <label for="extractSomeScript">특정 문자열을 가진 스크립트/노트만 추출</label>
        <input type="checkbox" id="extractSomeScript" v-model="settings.extractSomeScript">
      </div>
      <textarea v-show="settings.extractSomeScript" id="extractSomeScript2" spellcheck="false"
        v-model="extractSomeScript2Text" placeholder="showtext&#10;maintext&#10;.."></textarea>
    </details>

    <div style="margin-top:12px">
      <button class="btn2" @click="api.send('license')">오픈소스 라이센스</button>
    </div>
  </div>

  <div class="button-bar">
    <button class="btn btn-primary" @click="applySettings">적용</button>
    <button class="btn" @click="closeSettings">취소</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw } from 'vue'
import { api } from '../composables/useIpc'
import { DEFAULT_LLM_VERTEX_LOCATION } from '../../types/settings'
import { getRendererLlmProviderMetadata, getRendererLlmProviderUiText } from '../../types/llmProviderContract'

const settings = reactive<Record<string, any>>({
  loadingText: false, JsonChangeLine: false, DoNotTransHangul: false, ExtractAddLine: false,
  onefile_src: false, onefile_note: false, ExternMsgJson: false, oneMapFile: false,
  formatNice: false, HideExtractAll: false, extractSomeScript: false,
  llmProvider: 'gemini',
  llmApiKey: '', llmModel: 'gemini-3.0-flash-preview',
  llmOpenAiApiKey: '', llmCustomApiKey: '', llmCustomBaseUrl: 'http://localhost:1234/v1',
  llmClaudeApiKey: '', llmMaxTokens: 4096,
  llmVertexServiceAccountJson: '', llmVertexLocation: DEFAULT_LLM_VERTEX_LOCATION,
  llmSourceLang: 'ja', llmTargetLang: 'ko', llmTranslationUnit: 'file',
  llmChunkSize: 30, llmMaxRetries: 2, llmMaxApiRetries: 5, llmTimeout: 600,
  llmCustomPrompt: '',
})

const extractPlusText = ref('')
const extractSomeScript2Text = ref('')
const isVertexProvider = computed(() => settings.llmProvider === 'vertex')
const providerConfigHint = computed(() => getRendererLlmProviderUiText(settings.llmProvider).configHint)
const modelSuggestions = computed(() => getRendererLlmProviderMetadata(settings.llmProvider).modelSuggestions)

const generalSettings = [
  { key: 'loadingText', label: '진행도 퍼센트 표시' },
  { key: 'JsonChangeLine', label: '적용 JSON에서 줄바꿈 사용' },
  { key: 'DoNotTransHangul', label: '한글 문자열 번역하지 않기' },
  { key: 'ExtractAddLine', label: '내용 없는 문자열 추출 [MV/MZ]' },
]

const advancedSettings = [
  { key: 'onefile_src', label: '별도 파일로 스크립트 추출 [MV/MZ]' },
  { key: 'onefile_note', label: '별도 파일로 노트 추출 [MV/MZ]' },
  { key: 'ExternMsgJson', label: 'ExternMessage.csv 분리 추출 [MV/MZ]' },
  { key: 'oneMapFile', label: 'Map 파일 하나로 만들기 [MV/MZ]' },
  { key: 'formatNice', label: '추출 시 구분을 편하게 만들기 [MV/MZ]' },
  { key: 'HideExtractAll', label: '모두 추출 숨기기 [Wolf]' },
]

const sourceLangs = [
  { value: 'ja', label: '일본어' }, { value: 'en', label: '영어' },
  { value: 'zh-CN', label: '중국어 간체' }, { value: 'zh-TW', label: '중국어 정체' },
  { value: 'fr', label: '프랑스어' }, { value: 'es', label: '스페인어' },
  { value: 'ru', label: '러시아어' }, { value: 'de', label: '독일어' },
]

const targetLangs = [
  { value: 'ko', label: '한국어' }, { value: 'en', label: '영어' },
  { value: 'ja', label: '일본어' }, { value: 'zh-CN', label: '중국어 간체' },
  { value: 'zh-TW', label: '중국어 정체' }, { value: 'fr', label: '프랑스어' },
  { value: 'es', label: '스페인어' }, { value: 'ru', label: '러시아어' },
  { value: 'de', label: '독일어' }, { value: 'pt', label: '포르투갈어' },
  { value: 'it', label: '이탈리아어' }, { value: 'th', label: '태국어' },
  { value: 'vi', label: '베트남어' }, { value: 'ar', label: '아랍어' },
  { value: 'pl', label: '폴란드어' }, { value: 'nl', label: '네덜란드어' },
  { value: 'tr', label: '터키어' },
]

function applySettings() {
  // Parse extractPlus
  const extP: number[] = []
  for (const val of extractPlusText.value.split('\n')) {
    const tn = parseInt(val)
    if (!isNaN(tn)) extP.push(tn)
  }
  settings.extractPlus = extP
  settings.extractSomeScript2 = extractSomeScript2Text.value.split('\n')
  settings.llmVertexLocation = String(settings.llmVertexLocation || DEFAULT_LLM_VERTEX_LOCATION).trim() || DEFAULT_LLM_VERTEX_LOCATION
  settings.theme = 'Dracula'
  api.send('applysettings', { ...toRaw(settings) })
}

function closeSettings() {
  api.send('closesettings')
}

onMounted(() => {
  api.on('settings', (arg: unknown) => {
    const s = arg as Record<string, any>
    for (const key of Object.keys(settings)) {
      if (s[key] !== undefined) (settings as any)[key] = s[key]
    }
    if (s.extractSomeScript2) {
      extractSomeScript2Text.value = (s.extractSomeScript2 as string[]).join('\n')
    }
    if (s.extractPlus) {
      extractPlusText.value = (s.extractPlus as number[]).map(String).join('\n')
    }
    settings.llmVertexLocation = String(settings.llmVertexLocation || DEFAULT_LLM_VERTEX_LOCATION).trim() || DEFAULT_LLM_VERTEX_LOCATION
    if (s.themeData) {
      const root = document.documentElement
      for (const [key, val] of Object.entries(s.themeData as Record<string, string>)) {
        root.style.setProperty(key, val)
      }
    }
  })
  api.send('settingsReady')
})
</script>

<style scoped>
#container {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}
.settings-group { margin-bottom: 16px; }
.group-title { font-size: 14px; font-weight: 700; margin-bottom: 10px; opacity: 0.7; }
.setting-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0; gap: 12px;
}
.setting-item.multiline {
  display: block;
}
.setting-item.multiline label {
  display: block;
  margin-bottom: 4px;
}
.setting-item label { font-size: 13px; flex: 1; }
.text-input {
  background: var(--Highlight1); border: var(--border); border-radius: 6px;
  color: var(--mainColor); padding: 6px 10px; font-size: 13px; font-family: inherit;
  width: 220px;
}
.text-input.short { width: 100px; }
.hint { font-size: 11px; opacity: 0.4; }
.tag {
  font-size: 10px; padding: 1px 5px; border-radius: 4px;
  background: rgba(124,111,219,0.15); color: var(--accent);
}
textarea {
  width: 100%; min-height: 60px; background: var(--Highlight1);
  border: var(--border); border-radius: 6px; color: var(--mainColor);
  padding: 8px 10px; font-size: 12px; font-family: inherit; resize: vertical;
}
.textarea-label { font-size: 13px; margin-bottom: 4px; }
.provider-hint {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.55;
}
details { margin-top: 12px; }
summary { font-size: 13px; cursor: pointer; opacity: 0.7; }
.warn-text { font-size: 11px; color: #f1fa8c; margin: 6px 0 8px; }
.btn2 {
  background: transparent; border: var(--border); border-radius: 6px;
  color: var(--mainColor); padding: 6px 14px; cursor: pointer; font-size: 12px;
  font-family: inherit; opacity: 0.6; transition: var(--transition);
}
.btn2:hover { opacity: 1; }
.button-bar {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 10px 20px; border-top: 1px solid rgba(255,255,255,0.06);
}
.btn {
  padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: var(--transition);
  background: var(--Highlight1); border: var(--border); color: var(--mainColor);
}
.btn-primary {
  background: linear-gradient(135deg, var(--accent), #6c5ce7);
  border: none; color: #fff;
}
.btn-primary:hover { filter: brightness(1.1); }
</style>
