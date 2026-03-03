# Changelog

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
