# Wolf 추출·적용 성능 검증 (2026-09-05)

Wolf 프로젝트의 대사 추출과 번역 적용에서 반복 타이머와 중복 경로 검증을 줄였다. 운영 게임 파일이나 LLM 제공자는 사용하지 않았다. 결과는 생성한 유효한 Wolf 맵을 **실제 production 추출·적용 함수**로 처리한 측정이며, 앱 시작·렌더링·LLM 번역·복호화를 포함하는 전체 앱 성능 수치는 아니다.

## 기준 상태와 선택 근거

- 시작 시 이미 추적 파일 24개와 미추적 테스트/산출물에 사용자 변경이 있었다. 기존 변경을 보존하고, production 수정은 기존에 깨끗했던 `makeText.ts`, `applyWolf.ts` 두 파일로 한정했다.
- 변경 전 `npm test`: 70개 파일, 704개 테스트 통과. 기존 assertion 실패는 없었다. 최초 sandbox 실행의 `spawn EPERM`은 실행 환경 문제였으며, 로컬 하위 프로세스 실행을 허용한 뒤 기준 테스트를 확보했다.
- 기준 상태의 diff/파일 해시와 단위 테스트 로그는 `artifacts/performance/2026-09-05/`에 보관했다. `baseline/`에는 수정 전 두 production 파일의 정확한 사본이 있다. 사본은 TypeScript 빌드에 포함되지 않도록 `.ts.source` 확장자로 저장한다.
- 실제 사용자 경로는 `wolf_ext` → `extractWolfFolder` → `makeText`, `wolf_apply` → `wolfAppyier`이다. 대사량이 많을수록 사용자가 직접 기다려야 하는 작업을 선택했다.

| 조사한 후보 | 근거 수준 | 결정 |
| --- | --- | --- |
| Wolf 텍스트 생성의 대사별 타이머/진행 이벤트 | 실제 지연, timer/event 횟수 계측 | 구현 |
| Wolf 적용의 대사별 동일 경로 재해석 | 전체 적용 지연, 동기 FS 호출 횟수 계측 | 구현 |
| QA의 source/target 중복 읽기와 용어집 중복 조회 | 코드 확인; 미측정 | 보류: 영향 범위 대비 위 두 후보가 더 명확 |
| MCP 40줄 읽기에도 전체 파일의 줄 객체 생성 | 코드 확인; 미측정 | 보류: 응답 크기, CRLF/BOM, 해시 계약 영향 |
| 비교창 편집마다 전체 블록 상태 재계산 | 코드 확인; 미측정 | 보류: 기존 가상 스크롤이 있으며 실제 입력 지연 측정 필요 |
| MV/MZ 통합 맵 출력의 누적 개행 재탐색 | 코드 확인; 미측정 | 보류: 별도 재현 필요 |
| 번역 큐의 입력 전체 보관 및 성공마다 전체 캐시 저장 | 코드 확인; 미측정 | 보류: 재시작 복구·취소·파일별 완료 보장을 바꾸지 않고 별도 검증 필요 |

확인되지 않은 후보의 성능 수치는 추정하지 않았다. 효과가 작아 되돌린 구현 실험은 없으며, 두 구현 모두 유지했다.

## 변경

- `src/ts/wolf/extract/makeText.ts`: 문자열마다 `sleep(1)` 및 진행 이벤트를 실행하던 경로를 8ms 작업 예산 단위로 변경했다. 첫 진입과 예산 소진 시 `sleep(0)`으로 실제 이벤트 루프에 양보하고 진행 값을 보낸다. 문자열 순서, null 종료, backslash 처리, 빈 줄, 텍스트 줄 번호, staging/압축 메타데이터 생성은 유지한다.
- `src/ts/wolf/apply/applyWolf.ts`: `normalizeWolfSources`의 두 동기 루프에서 raw `sourceFile`별로 검증된 경로를 재사용한다. Map은 한 함수 호출에만 존재하고 고유 입력 경로 수 이하로 제한된다. 각 alias는 첫 사용 시 원래 resolver를 통과한다. 경로 포함 여부·symlink·일반 파일 검사, canonical 경로 bytes 충돌, 적용 전/commit 전/rename 후 원본 bytes 검사, fsync와 rollback은 유지한다.
- `scripts/benchmark-wolf.cjs`, `test/utils/wolfMapFixture.ts`: 유효한 맵 생성, 원본 소스 스냅샷, 전체 추출·적용 측정, 작업량 계측, 바이트 동등성 검사를 제공한다.
- `test/unit/wolfTextGeneration.test.ts`, `test/unit/wolfSourceNormalization.test.ts`: 14개 회귀 사례를 추가했다.

## 측정 방법

- 환경: Windows 10.0.26200, x64, AMD Ryzen 7 7800X3D, 논리 CPU 16개, Node v24.14.0. 동일한 설치 의존성과 프로세스를 사용했다.
- 입력: 맵 10개에 대사 200개 또는 2,000개를 분배한 Wolf v3 바이너리. 일본어, 여러 줄, 의도적 빈 줄, 마지막 개행, null 종료 유무, 제어 코드를 포함한다.
- 추출 구간: 맵 파일 열기/파싱 → `makeText`의 디코딩/줄 번호 생성 → 텍스트 및 압축 `.extracteddata` 쓰기 → 디렉터리 staging commit.
- 적용 구간: 압축 metadata 재읽기 → 번역 텍스트 읽기 → 경로/내용/형식 검증 → 바이너리 조립 → 원본 재확인 → fsync staging → atomic commit.
- 수정 전 별도 기준 측정은 입력마다 워밍업 1회 + 측정 3회. 최종 비교는 입력·버전마다 워밍업 1회 + 측정 5회이며, before/current 순서를 AB/BA로 번갈아 실행했다. 다른 빌드/테스트와 동시에 측정하지 않았다.
- 매번 새 fixture를 생성했다. OS 파일 캐시를 강제로 비우지 않았으며 fixture 쓰기가 캐시를 데운다. 첫 호출/워밍업 원시 값은 JSON에 따로 보관하고 집계에서 제외했다. 콜드 디스크 성능 측정은 아니다.
- 생성과 준비, 빌드/모듈 로딩, 출력 동등성 assertion은 시간에서 제외했다. 프로덕션 진행 이벤트 발생 횟수를 세었으며 Electron IPC 전송·Vue 렌더링 비용은 포함하지 않았다.
- `fsCalls`는 Node 동기 FS API 호출 횟수이며 커널 syscall 횟수가 아니다. 5ms heartbeat의 최대 간격은 이벤트 루프 관찰값이며 프레임 렌더 시간은 아니다. CPU 사용 시간은 원시 JSON에 있지만 이 Windows 환경의 시간 분해능 때문에 주요 개선 지표로 쓰지 않았다.
- 결과 텍스트를 독립적인 예상 문자열과 비교하고, 메타데이터 roundtrip 및 압축 bytes hash를 비교한다. 번역 적용 후 모든 맵을 독립적으로 생성한 기대 바이너리와 바이트 단위로 비교한다. 모든 입력/반복/before/current digest가 같아야 실행이 성공한다.

측정 원시 값: [`before.json`](../artifacts/performance/2026-09-05/before.json), [`comparison.json`](../artifacts/performance/2026-09-05/comparison.json). 각 JSON에는 모듈별 소스 SHA-256, 조건, 워밍업, 모든 반복 값이 포함된다.

## 실측 결과

최종 교차 비교의 중앙값과 5회 최소–최대 범위다. 단위는 ms이며, 개선율은 중앙값의 시간 감소율이다.

| 대사 / 맵 수 | 작업 | 변경 전 중앙값 [최소–최대] | 변경 후 중앙값 [최소–최대] | 시간 감소 |
| --- | --- | --- | --- | --- |
| 200 / 10 | 추출 | 3,212.85 [3,150.39–3,230.76] | 161.84 [148.97–172.33] | 94.96% |
| 200 / 10 | 적용 | 211.75 [198.61–270.78] | 39.68 [38.59–43.31] | 81.26% |
| 2,000 / 10 | 추출 | 30,846.73 [30,771.09–30,933.31] | 152.26 [131.66–174.02] | 99.51% |
| 2,000 / 10 | 적용 | 1,701.54 [1,573.98–2,246.20] | 50.16 [47.46–57.80] | 97.05% |

2,000개 대사에서 원인을 설명하는 작업량도 감소했다. 아래 호출 횟수는 각 5회 측정에서 동일했다.

| 지표 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 전체 추출의 타이머 예약 | 2,010 | 11 |
| 전체 추출의 `loading` 이벤트 | 2,012 | 13 |
| 전체 적용의 `realpathSync` | 6,030 | 30 |
| 전체 적용의 `existsSync` | 2,022 | 22 |
| 전체 적용의 `lstatSync` | 2,010 | 10 |
| 전체 적용의 `readFileSync` / `writeFileSync` | 32 / 10 | 32 / 10 |
| 전체 적용의 `fsyncSync` / `renameSync` | 10 / 20 | 10 / 20 |

- 추출은 처리 자체보다 문자열당 타이머 대기가 지배했다. 문자열 2,000개를 처리하는 데 CPU 사용 시간은 작지만 벽시계 시간은 30초 이상이었다. 문자열별 타이머를 없앤 뒤 추출 시간은 이 fixture에서 남아 있는 맵별 타이머 10회와 압축/쓰기 비용 위주가 됐다.
- 적용은 반복 경로 해석이 지배했다. 검증 후 원본을 읽고 flush/commit하는 호출 횟수는 그대로이고, 중복 경로 확인만 줄었다.
- 2,000개 적용의 최대 heartbeat 간격 중앙값은 1,701.56 → 50.19ms였다. 추출은 24.51 → 26.00ms였으므로 **추출의 최대 이벤트 루프 지연 개선은 주장하지 않는다**. 빠른 문자열 변환 뒤 압축/쓰기 등의 동기 구간은 남는다.
- 수정 전 별도 기준 측정 3회의 중앙값은 2,000개 추출 30,803.49ms, 적용 1,627.33ms였다. 최종 비교의 before 소스 SHA-256 전체가 이 기준 측정의 소스 목록과 같음을 확인했다.
- 200개와 2,000개의 변경 후 추출 시간 차이는 OS 타이머/스케줄링 변동 범위와 겹친다. 데이터가 늘면 빨라진다는 의미가 아니다.
- 모든 반복에서 원본/텍스트/압축 metadata/적용 맵 digest가 같았고, 각 적용 결과 전체 바이트가 기대 바이너리와 일치했다.

집중 회귀 검증은 5개 파일·42개 테스트가 통과했다. 기존 사용자 추적 파일의 초기 해시와 대조했을 때 추가로 바뀐 기존 파일은 위 두 production 파일뿐이었다. 전체 타입 검사·coverage 단위 테스트·빌드·core/eval/Electron UI·기본 package smoke의 최종 결과와 각 명령/로그 경로는 [`artifacts/verify/latest.json`](../artifacts/verify/latest.json)에 있다. package smoke의 opt-in 또는 현재 런타임에서 불가능한 사례는 통과와 구분해 해석해야 한다.

최초 전체 검증에서는 측정용 `.ts` 사본이 저장소 전역 TypeScript 입력에 포함되어 빌드가 실패했다. 사본의 bytes를 유지한 채 `.ts.source`로 보관 형식과 로더를 수정하고, 작은 비교 실행으로 로딩·동등성을 확인한 뒤 전체 검증을 재실행했다. production 코드나 본 측정의 실행 루프는 이 수정으로 바뀌지 않았다.

## 재현

현재 저장소와 보관된 수정 전 snapshot을 비교한다. 다른 빌드/검증과 동시에 실행하지 않는다.

```powershell
node scripts/benchmark-wolf.cjs --baseline-dir artifacts/performance/2026-09-05/baseline --counts 200,2000 --runs 5 --output artifacts/performance/2026-09-05/recheck.json
```

새로운 최적화 전에 기준 소스를 보관하려면 빈 디렉터리를 지정한다. 기존 snapshot 파일은 덮어쓰지 않는다.

```powershell
node scripts/benchmark-wolf.cjs --capture-baseline artifacts/performance/new-baseline --counts 200,2000 --runs 3 --output artifacts/performance/new-before.json
```

집중 회귀 테스트:

```powershell
npm test -- test/unit/wolfTextGeneration.test.ts test/unit/wolfSourceNormalization.test.ts test/unit/wolfWorkflowSafety.test.ts test/unit/wolfExtData.test.ts test/unit/parallelExtractApplySafety.test.ts
npm run verify:plan
npm run verify
```

## 정확성 범위와 한계

- Wolf v2 Shift_JIS와 v3 UTF-8의 텍스트/빈 줄/코드/null/줄 번호와 metadata roundtrip을 검증한다. v2 성능은 별도로 측정하지 않았다.
- 경로 재사용은 호출 내부에 한정된다. 다음 호출 전 파일 삭제·디렉터리 교체, 다른 프로젝트의 같은 이름, alias 충돌, 프로젝트 밖 경로, symlink 거부, 원본 변경, staging 실패와 여러 파일 rollback을 검증한다.
- 시간 분할 중 실제 타이머가 실행될 수 있고 진행률이 단조롭게 증가하다 마지막에 0으로 돌아가는지 검증한다. Wolf의 기존 기능 범위 밖인 취소 기능은 추가하지 않았다.
- 단일 초대형 문자열의 디코딩/분할과 마지막 동기 압축·파일 쓰기는 8ms 예산을 넘을 수 있다. 적용도 동기 단계 자체는 남아 있다. 메모리 최대값·앱 전체 CPU·브라우저 프레임 지연 개선은 주장하지 않는다.
- Windows의 타이머 정밀도, CPU와 저장장치, 실제 게임의 맵 수/문자열 길이/압축률에 따라 절대 시간과 개선 비율은 달라진다. 실제 사용자 게임·복호화·LLM 호출·포장된 앱 전체 플로우의 성능은 측정하지 않았다.
