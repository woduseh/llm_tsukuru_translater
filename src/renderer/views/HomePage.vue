<template>
  <TitleBar />
  <main class="home-console" data-harness-view="home">
    <aside class="home-rail" aria-label="주 메뉴">
      <strong>TC</strong>
      <span class="rail-current">시작</span>
      <button type="button" data-harness-agent-workspace-entry @click="$router.push('/agent-workspace')">AI 작업공간</button>
    </aside>
    <section class="home-main">
      <header>
        <p class="eyebrow">LOCALIZATION WORKSPACE</p>
        <h1>번역 프로젝트를 시작하세요</h1>
        <p class="subtitle">게임 엔진을 선택하면 추출부터 검수와 적용까지 한 흐름으로 이어집니다.</p>
      </header>

      <div class="engine-list" aria-label="프로젝트 유형">
        <button type="button" @click="$router.push('/mvmz')">
          <span class="engine-code">MV / MZ</span>
          <span>
            <strong>RPG Maker 프로젝트</strong>
            <small>JSON 데이터 · 번역 비교 · 구조 검증</small>
          </span>
          <b>시작</b>
        </button>
        <button type="button" @click="$router.push('/wolf')">
          <span class="engine-code">WOLF</span>
          <span>
            <strong>Wolf RPG 프로젝트</strong>
            <small>DB · 커먼 이벤트 · 맵 이벤트</small>
          </span>
          <b>시작</b>
        </button>
      </div>

      <footer>
        <span><i></i> 로컬 파일은 선택한 작업에서만 처리됩니다</span>
      </footer>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import TitleBar from '../components/TitleBar.vue'
import { api, useIpcOn } from '../composables/useIpc'

useIpcOn('getGlobalSettings', (tt: Record<string, unknown>) => {
  if (tt && tt.themeData) {
    const root = document.documentElement
    for (const [key, val] of Object.entries(tt.themeData as Record<string, string>)) {
      root.style.setProperty(key, val)
    }
  }
})

onMounted(() => {
  api.send('mainReady')
})
</script>

<style scoped>
.home-console { flex: 1; min-height: 0; display: grid; grid-template-columns: 112px 1fr; }
.home-rail { padding: 18px 12px; border-right: var(--border); background: #0c1216; display: flex; flex-direction: column; gap: 10px; }
.home-rail strong { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid #50616a; border-radius: 8px; color: var(--Healthy); }
.home-rail span, .home-rail button { width: 100%; padding: 9px 8px; border-radius: 6px; text-align: left; font-size: 12px; }
.home-rail .rail-current { margin-top: 20px; background: #182329; border-left: 3px solid var(--Accent); color: var(--mainColor); font-weight: 800; }
.home-rail button { margin-top: auto; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.home-rail button:hover { color: var(--mainColor); background: #172027; }
.home-main { padding: 30px 34px 22px; display: flex; flex-direction: column; min-width: 0; }
.eyebrow { color: var(--Healthy); font-size: 11px; font-weight: 800; letter-spacing: 1.1px; }
.home-main h1 { margin-top: 6px; font-size: 28px; letter-spacing: -.6px; }
.home-main header > p:last-child { margin-top: 7px; color: var(--muted); }
.engine-list { margin-top: 28px; border-top: var(--border); }
.engine-list button { width: 100%; min-height: 82px; display: grid; grid-template-columns: 86px 1fr auto; align-items: center; gap: 18px; padding: 14px 10px; background: transparent; border: 0; border-bottom: var(--border); text-align: left; cursor: pointer; }
.engine-list button:hover { background: #151f24; }
.engine-code { color: var(--Accent); font-size: 12px; font-weight: 900; letter-spacing: .5px; }
.engine-list strong, .engine-list small { display: block; }
.engine-list strong { font-size: 15px; }
.engine-list small { margin-top: 4px; color: var(--muted); }
.engine-list b { padding: 7px 12px; border: var(--border); border-radius: 6px; font-size: 12px; }
.engine-list button:hover b { border-color: #9d6d18; color: #ffc04a; }
.home-main footer { margin-top: auto; padding-top: 16px; border-top: var(--border); display: flex; align-items: center; color: var(--muted); font-size: 12px; }
.home-main footer i { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: var(--Success); }
</style>
