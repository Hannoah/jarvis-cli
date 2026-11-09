# 프로젝트 컨텍스트

## 무엇인가
jarvis-ts는 사용자 PC의 파일·터미널·Git·웹·위키 도구 39개를 허용 폴더 안에서만 쓰게 해 주는 **MCP 서버**(Dev Tunnel + 웹 대시보드 + OAuth)다. 사용자는 이 서버를 **매일** 띄워 Copilot Studio·Claude·Cursor에 연결해 쓴다.

jarvis-cli는 같은 도구를 두 가지로 쓰게 만든 공개 CLI다.
1. **터미널에서 직접 실행** — `jarvis read_file notes.txt`, 대화형 입력창(`jarvis`), 서버 없이.
2. **로컬 MCP 서버** — `jarvis start -d`로 jarvis-ts와 같은 서버·터널·대시보드를 띄우고 `stop/restart/status/tunnel/mcp`로 제어.

## jarvis-ts와의 관계 (단일화 완료 — 2026-11-09)
- 초기에는 `jarvis-ts`(v0.3.2) 코드를 복사해 와서 시작했으나, 이후 모든 기능 확장(42개 도구, VPN, 파일 공유, 터널 자가 치유, 보안 패치 등)과 CLI/대시보드 인터페이스가 `jarvis-cli`에서 이루어졌다.
- **2026-11-09부로 구버전 `jarvis-ts` 로컬 폴더를 완전히 폐기하고 `jarvis-cli` 단일 프로젝트로 일원화**했다.
- `jarvis-ts`에 남아 있던 유용한 자산(`docs/agent-system-prompt.md`, `assets/jarvis.svg`, `custom_tools/sample_calculator.mjs`, `.github/workflows/ci.yml`)과 백업 파일(`.backups/*.bak`)은 모두 `jarvis-cli` 및 `~/.jarvis`로 이관 완료했다.
- 기본 설정 폴더는 `~/.jarvis`다 (`JARVIS_HOME`으로 변경 가능).
- 맨 `jarvis`(인자 없음)는 **인터랙티브 입력창**을 열고, 서버는 `jarvis start`(또는 백그라운드 `jarvis start -d`)로 실행한다.

## 복사한 코드 중 우리가 고친 곳 (다시 복사할 때 유지할 것)
| 파일 | 원본과 다른 점 |
|---|---|
| `src/core/paths.ts` | 기본 데이터 폴더가 `~/.jarvis`(원본은 `<앱>/data`). 마이그레이션 제거(`migrate.ts` 삭제) |
| `src/main.ts` | `prepareDataDir()`가 마이그레이션 결과를 돌려주지 않는 것에 맞춤 |
| `src/supervisor/dashboard.ts` | `POST /api/shutdown` 추가(`DashboardDeps.shutdown`). 이 파일은 **UTF-8이 아닌 바이트**가 있어 편집 도구가 거부한다 → 바이트 단위로 수정 |
| `src/supervisor/index.ts` | `stopAll()`을 만들어 `stop()`과 `shutdown`이 같이 쓰게 함 |
| `src/server/http.ts` | `limitKey()`: 터널 트래픽(루프백 + `x-forwarded-*`)도 레이트리밋 |
| `src/server/plugins.ts`, `src/core/config.ts` | `custom_tools/`가 설치 폴더가 아니라 설정 폴더 기준 |
| `src/supervisor/settings.ts`, `src/security/auth.ts`, `src/supervisor/index.ts` | 키 생성·회전·터널 ID 변경이 모두 `security/identity.ts`를 거침(PC 고유값). `updateEnvFile`은 `core/envfile.ts`로 옮기고 settings가 다시 내보냄 |
| `src/server/http.ts` (추가) | `/mcp` 본문을 먼저 읽어 `[AGENT]` 감사 줄을 남기고 파싱된 본문을 트랜스포트에 넘김 |
| `src/tools/enterprise.ts`, `src/system/cliEnv.ts` | 개인 경로 기본값 제거(`VIYA_CLI_DIR`, `JARVIS_STATUS_DEPLOY_DIR`, `JARVIS_DEFAULT_KUBECONFIG`), 안내 문구 영어 |

원본 `jarvis-ts`와 달리 `jarvis-cli`에는 `cli.ts` 외 진입점이 없다. `serve`는 `main.ts`를 import하고, supervisor는 `main.js`(빌드된 경우)를 자식 프로세스로 띄운다.

## 제약과 전제
- Node 22 이상. 도구가 PowerShell을 쓰므로 **Windows에서만 검증**했다(macOS/Linux는 `pwsh` 필요, 미검증).
- 터미널 출력은 Windows Terminal·VS Code(24비트), 그 외(256색)를 가정한다. `NO_COLOR`를 따른다.
- AI 모델 연동(대화형 에이전트)은 **없다.** 사람이 도구를 고르거나 입력한다. 요청이 있으면 별도 작업.
