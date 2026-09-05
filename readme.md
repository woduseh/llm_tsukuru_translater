# LLM Tsukuru Translater

RPG Maker MV/MZ 및 Wolf RPG Editor 게임의 텍스트를 추출·번역·적용하는 데스크톱 도구.

## 주요 기능

- RPG Maker MV/MZ JSON 데이터 추출 및 적용
- Gemini, Vertex AI, OpenAI, OpenAI 호환 API 또는 Claude 기반 자동 번역
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

- Node.js 22.13 이상인 22.x (CI는 Node 22 사용)
- Windows OS (Electron 빌드 대상)

### 개발 환경 설정

Windows x64에서 프로젝트 전용 Node 22.23.2 / npm을 쓰려면 다음 PowerShell 명령을 사용하세요. 첫 실행은 공식 Node ZIP을 내려받아 SHA256을 확인하고 `.tools/`에 설치해요. 이 명령 안에서만 런타임을 선택하며, 관리자 권한이나 전역 Node 변경은 필요하지 않아요.

```powershell
.\scripts\dev-env.ps1 ci --prefer-offline --no-audit --fund=false
.\scripts\dev-env.ps1 run doctor
.\scripts\dev-env.ps1 run dev '--' --smoke
.\scripts\dev-env.ps1 run verify:full
```

인수 없이 실행하면 `doctor`, `run dev`는 대화식 개발 실행이에요. PowerShell에서 npm 스크립트에 옵션을 넘길 때는 예제처럼 `'--'`를 따옴표로 감싸야 해요. 다운로드와 프로세스 실행은 현재 실행 환경에서 허용돼야 하며, 이 스크립트는 권한 정책을 변경하지 않아요. Node 22 환경이 이미 준비돼 있다면 아래 기본 명령을 바로 사용할 수 있어요.

```bash
# 체크아웃마다 lockfile 기준 설치 (Electron 다운로드와 설치 스크립트 필요)
npm ci

# 런타임·의존성·프로세스/포트 접근 사전 진단
npm run doctor

# 메인/MCP 빌드 → Vite 준비 → 격리된 Electron 실행
npm run dev

# 홈 화면의 Vue/preload 준비 신호 확인 후 자동 종료
npm run dev -- --smoke

# TypeScript 타입 검사
npm run typecheck

# 테스트 실행
npm test

# 린트 실행
npm run lint
```

`dev`는 실행별 빈 포트와 설정·로그·세션 프로필을 사용해요. 5173부터 사용 가능한 포트를 선택하고 실제 주소를 Electron에 전달해요. 앱을 닫거나 Ctrl+C로 종료하면 서버와 개인 상태를 정리하고 `artifacts/dev/latest.json` 및 실행별 로그를 남겨요. 개발 프로필의 설정은 유지되지 않으며 메인/preload 변경은 `dev`를 다시 실행해야 반영돼요. 평소 사용자 설정으로 빌드된 앱을 실행하려면 `npm start`를 사용하세요.

변경 후에는 `npm run verify:plan` → `npm run verify`를 사용하세요. 실제 Electron 동작 검사는 `npm run harness:ui`, 전체 결정적 검사는 `npm run verify:full`이에요. 환경 진단 통과나 홈 화면 smoke만으로 번역·적용 동작이 검증되지는 않아요. 실패 진단과 검증 범위는 [HARNESS.md](docs/HARNESS.md)를 참조하세요.

### 프로덕션 빌드

```bash
# Windows 포터블 실행 파일
npm run dist:portable

# Windows NSIS 설치 파일
npm run dist:installer

# 포터블 + 설치 파일 모두 생성
npm run dist:all
```

### LLM 제공자 설정

이 앱은 **Gemini API**, **Google Vertex AI**, **OpenAI**, **OpenAI 호환 API**, **Claude**를 지원합니다. 모든 제공자는 같은 번역, 재번역, JSON 검증 복구 흐름을 공유하며, 설정에서 활성 제공자를 선택해 사용합니다.

1. **설정 → LLM 번역**으로 이동합니다.
2. 사용할 제공자를 선택하고 모델과 필요한 인증 정보를 입력합니다.
   - Gemini: API 키
   - Vertex: Google Cloud Service Account JSON 전체와 위치(기본값 `global`)
   - OpenAI: API 키
   - OpenAI 호환 API: `/v1` Base URL과 선택적 API 키
   - Claude: API 키와 최대 토큰 수
3. 적용 후 번역 시작, 재번역, JSON 검증 복구는 현재 선택한 제공자를 사용합니다.

추가 안내:

- 제공자별 설정은 유지되므로 제공자를 다시 선택하면 저장된 구성을 계속 사용할 수 있습니다.
- Vertex는 파일 선택이 아니라 **JSON 전체 붙여넣기** 방식입니다.
- 설정 창을 제외한 번역 시작 창과 JSON 검증 창에는 인증 정보 원문을 보내지 않고, 준비 상태와 필요한 설정만 전달합니다.

## CI/CD

- **CI**: `main` branch push/PR 시 메인·Vue 타입 검사, 린트, 테스트와 deterministic harness 실행
- **Release**: `v*` 태그 push 시 CI 검증 후 Windows 빌드 → GitHub Release 자동 공개

## 프로젝트 구조

```
main.ts              # Electron 메인 프로세스 진입점
src/
├── agent/           # 에이전트 분석 커널, 작업공간, QA, 터미널 서비스
├── harness/         # Electron UI 하네스 런타임
├── ipc/             # 추출·번역·도구·에이전트·터미널 IPC 핸들러
├── mcp/             # 프로젝트 보호 MCP stdio 서버와 도구 레지스트리
├── renderer/        # Vue 3 SPA (Vite로 빌드 → dist-renderer/)
│   ├── views/       # 운영 화면과 Agent Workspace 페이지
│   ├── composables/ # Vue composables (useIpc)
│   └── router.ts    # Hash 기반 라우터
├── ts/
│   ├── rpgmv/       # RPG Maker MV/MZ 파이프라인 (extract, apply, translate, verify)
│   │   └── extract/ # 추출 모듈 (index, parser, formatter, io)
│   ├── wolf/        # Wolf RPG Editor 파이프라인 (extract, apply, parser)
│   └── libs/        # 제공자·번역·파일·검증 공유 라이브러리
├── types/           # 설정, IPC, 제공자, 에이전트 타입 정의
├── preload.ts       # Electron preload (contextBridge)
├── appContext.ts    # 앱 상태 싱글톤
└── utils.ts         # 인코딩/파일 유틸리티
test/
├── unit/            # Vitest 단위 테스트
└── fixtures/        # 단위·하네스 픽스처
scripts/harness/     # core, eval, UI, live, package smoke 실행기
```

## 핵심 워크플로우

1. **추출 (Extract)**: 게임 `data/` 폴더의 JSON 파일을 파싱하여 `.txt` + `.extracteddata` 메타데이터 생성
2. **번역 (Translate)**: `.txt` 파일을 현재 선택한 LLM 제공자로 번역
3. **적용 (Apply)**: 번역된 `.txt` + 메타데이터를 원본 JSON에 재적용

Agent Workspace와 외부 MCP 서버는 프로젝트 상태와 번역 품질 분석을 지원합니다. 오프라인 MCP 도구는 원본 게임·번역 파일을 직접 수정하지 않으며, 필요한 분석 산출물만 `.llm-tsukuru-agent/` 아래에 기록합니다. 실행 중인 앱에 연결된 MCP는 제한된 `patch.apply` 변경안을 승인 큐에 제출할 수 있지만 직접 승인하거나 쓰기 권한을 얻을 수는 없습니다. 사용자가 앱 UI에서 명시적으로 승인하면 메인 프로세스가 그 요청에 결박된 파일 하나만 원자적으로 적용하고 결과를 검증합니다. 실제 추출·번역·적용과 변경 승인은 앱 UI가 소유합니다.

## 개발 문서

저장소의 에이전트 개발 지침은 [Codex용 AGENTS.md](AGENTS.md)로 통합합니다. 구조·품질 계약·검증 명령은 해당 파일의 주제별 링크에서 확인할 수 있습니다.

## 라이선스

GPL-3.0
