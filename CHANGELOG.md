# Changelog

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
