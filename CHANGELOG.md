# Changelog

## [3.1.2] - 2026-03-28

### 수정

- Wolf 추출 타입 정의를 전용 모듈로 분리하고, 메타데이터 검증 코드가 ambient 전역 타입에 암묵적으로 의존하지 않도록 정리
- 레거시 `.extracteddata` 파일이 `type` 마커 없이도 타입 선언과 일치하도록 `ExtractedDataEntry` 정의를 정리
- 설정 저장 경로의 중복 `themeList` 재할당을 제거하고, 관련 회귀 테스트 및 타입스크립트 컴파일 픽스처를 추가

## [3.1.1] - 2026-03-28

### 수정

- 설정 창에서 넘어오는 payload와 저장된 설정 값을 런타임 검증해 잘못된 값과 알 수 없는 키를 그대로 저장하지 않도록 변경
- `.extracteddata`와 Wolf 추출 메타데이터를 읽을 때 구조 검증을 추가하고, Wolf 바이너리 캐시를 다시 `Buffer`로 복원하도록 변경
- 번역 비교/JSON 검증 화면의 summary 렌더링에서 `v-html`을 제거하고, preload 및 메인 프로세스의 미사용 raw `log` IPC 채널을 제거
- 저장소에 남아 있던 `debug_crash.log`를 제거

## [3.1.0] - 2026-03-28

### 추가

- Gemini API와 Google Vertex AI 중 하나를 선택할 수 있는 LLM 제공자 설정
- Google Cloud Service Account JSON 붙여넣기와 Vertex 위치(`global` 기본값) 지원
- `google-auth-library` 기반 Vertex AI 번역 클라이언트 및 OAuth 인증 경로
- 제공자별 설정 안내 문구와 안전한 준비 상태 payload를 사용하는 번역 시작/JSON 검증 UI

### 변경

- 전체 번역, 파일 재번역, 블록 재번역, JSON 검증 복구가 모두 현재 선택한 LLM 제공자를 사용하도록 변경
- 캐시 키와 번역 로그에 제공자 메타데이터를 포함해 Gemini/Vertex 결과가 서로 섞이지 않도록 변경

## [3.0.1] - 2026-03-03

### 추가

- 번역 비교 — 역방향 텍스트 줄밀림 감지 (헤더 패턴이 번역값에 누출된 경우)
- 테스트 324개 (47개 추출/적용, 59개 검증, 54개 비교, 61개 번역기 등)
- GitHub Actions Release 워크플로우 (v* 태그 → 자동 빌드 및 배포)

### 개선

- `removeDuplicateHeaders` 캐스케이드 병합 버그 수정
- 핫패스 성능 최적화 (parser: O(k²)→O(k), formatter: Set 변환, apply: `in` 연산자)
- 데드 코드 제거 (parser/formatter 미사용 변수 정리)
- `src/js/` → `src/ts/` 폴더 구조 개선
- 생성된 `.js` 파일 git에서 제거 및 `.gitignore` 패턴 추가
- copilot-instructions 문서에서 폐기된 dual-file 규칙 삭제

### 변경

- 프로젝트명 LLM Tsukuru Translater로 변경
- `appId`: `net.electron.LlmTsukuruTranslater`

## [3.0.0] - 2026-03-03

### 추가

- TypeScript strict 모드 활성화
- Electron contextIsolation + preload 보안 모델
- 136개 유닛 테스트 (vitest)
- GitHub Actions CI 파이프라인
- ESLint + @typescript-eslint 린팅
- AppSettings / RPG Maker 데이터 타입 인터페이스
- preload nodeFs 경로 화이트리스트
- WolfDec.exe 다운로드 SHA-256 검증

### 개선

- main.ts 모듈 분리 (750줄 → 37줄 + 6개 IPC 모듈)
- extract.ts 분할 (577줄 → 4개 파일)
- renderer.ts 분할 (618줄 → 6개 파일)
- globalThis.mwindow 47건 → appContext 추상화 교체
- any 타입 113건 → 20건 (-82%)
- innerHTML 15건 → 0건 (DOM API 교체)
- 빈 catch 블록 11건 수정
- API 키 URL 파라미터 → 헤더 전송
- electron-store 암호화 활성화

### 제거

- 중복 유틸리티 함수 통합 (sleep, rmBom, worked, sendAlert 등)
