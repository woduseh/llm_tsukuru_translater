# LLM Tsukuru Translater

RPG Maker MV/MZ 및 Wolf RPG Editor 게임의 텍스트를 추출·번역·적용하는 데스크톱 도구.

## 주요 기능

- RPG Maker MV/MZ JSON 데이터 추출 및 적용
- Gemini LLM 기반 자동 번역
- 번역 비교 및 JSON 검증·자동 복구
- JSON/CSV 추출
- 플러그인 메모 추출
- MV/MZ 이미지·오디오 복호화
- 폰트·크기 변경
- 버전 업그레이드 도구
- Wolf RPG Editor 지원

사용법은 깃허브 내 위키를 참조해주세요.

## 설치 및 실행

### 요구 사항

- Node.js 20 이상
- Windows OS (Electron 빌드 대상)

### 개발 환경 설정

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm start

# TypeScript 타입 검사
npx tsc --noEmit

# 테스트 실행
npm test

# 린트 실행
npm run lint
```

### 프로덕션 빌드

```bash
# Windows x64 빌드 (portable + NSIS installer)
npm run build
```

## CI/CD

- **CI**: `main` branch push/PR 시 자동으로 타입체크 + 린트 + 테스트 실행
- **Release**: `v*` 태그 push 시 CI 검증 후 Windows 빌드 → GitHub Release (draft) 자동 생성

```bash
git tag v3.0.1
git push origin v3.0.1
```

## 프로젝트 구조

```
main.ts              # Electron 메인 프로세스 진입점
src/
├── ipc/             # IPC 핸들러 모듈 (extract, settings, translate, tools, window, shared)
├── renderer/        # Vue 3 SPA (Vite로 빌드 → dist-renderer/)
│   ├── views/       # 페이지 컴포넌트 (MvMz, Wolf, Settings, LlmSettings, LlmCompare, JsonVerify, Home)
│   ├── composables/ # Vue composables (useIpc)
│   └── router.ts    # Hash 기반 라우터
├── ts/
│   ├── rpgmv/       # RPG Maker MV/MZ 파이프라인 (extract, apply, translate, verify)
│   │   └── extract/ # 추출 모듈 (index, parser, formatter, io)
│   ├── wolf/        # Wolf RPG Editor 파이프라인 (extract, apply, parser)
│   └── libs/        # 공유 라이브러리 (projectTools, geminiTranslator, rpgencrypt, fileIO)
├── types/           # TypeScript 타입 정의 (settings)
├── preload.ts       # Electron preload (contextBridge)
├── appContext.ts    # 앱 상태 싱글톤
└── utils.ts         # 인코딩/파일 유틸리티
test/
├── unit/            # 유닛 테스트 (vitest, 324개)
└── fixtures/        # 테스트 픽스처
```

## 핵심 워크플로우

1. **추출 (Extract)**: 게임 `data/` 폴더의 JSON 파일을 파싱하여 `.txt` + `.extracteddata` 메타데이터 생성
2. **번역 (Translate)**: `.txt` 파일을 Gemini LLM API로 번역
3. **적용 (Apply)**: 번역된 `.txt` + 메타데이터를 원본 JSON에 재적용

## 라이선스

GPL-3.0