# 프로젝트 컨텍스트

## 무엇인가
jarvis-ts는 사용자 PC의 파일·터미널·Git·웹·위키 도구 39개를 허용 폴더 안에서만 쓰게 해 주는 **MCP 서버**(Dev Tunnel + 웹 대시보드 + OAuth)다. 사용자는 이 서버를 **매일** 띄워 Copilot Studio·Claude·Cursor에 연결해 쓴다.

jarvis-cli는 같은 도구를 두 가지로 쓰게 만든 공개 CLI다.
1. **터미널에서 직접 실행** — `jarvis read_file notes.txt`, 대화형 입력창(`jarvis`), 서버 없이.
2. **로컬 MCP 서버** — `jarvis start -d`로 jarvis-ts와 같은 서버·터널·대시보드를 띄우고 `stop/restart/status/tunnel/mcp`로 제어.

## jarvis-ts와의 관계
- jarvis-ts는 **비공개 저장소**이고 LICENSE가 없다. jarvis-cli는 그 코드를 복사해 와서 **사용자가 MIT로 공개하는 것에 동의**하고 만들었다(2026-11-06 확인). 원본 쪽 공개 권한은 사용자가 따로 확인하기로 했다.
- **두 프로그램은 같은 포트(MCP 8765, 대시보드 8766)를 쓴다.** 동시에 실행할 수 없다.
- jarvis-cli의 기본 설정 폴더는 `~/.jarvis`다. jarvis-ts의 설정(API 키·OAuth 토큰·터널 ID)은 jarvis-ts의 `data` 폴더에 있다. **이어서 쓰려면 `JARVIS_HOME`을 그 폴더로 지정**한다. 자동 복사는 하지 않는다. 지정하면 jarvis-cli로 실행 중인 jarvis-ts 인스턴스를 `status/mcp/restart/tunnel`로 제어할 수 있다(`stop`은 아래 참고).
- 맨 `jarvis`(인자 없음)의 의미가 다르다. jarvis-ts는 서버를 시작하지만 jarvis-cli는 **인터랙티브 입력창**을 연다(사용자 요청). 서버는 `jarvis start`.

## 복사한 코드 중 우리가 고친 곳 (다시 복사할 때 유지할 것)
| 파일 | 원본과 다른 점 |
|---|---|
| `src/core/paths.ts` | 기본 데이터 폴더가 `~/.jarvis`(원본은 `<앱>/data`). 마이그레이션 제거(`migrate.ts` 삭제) |
| `src/main.ts` | `prepareDataDir()`가 마이그레이션 결과를 돌려주지 않는 것에 맞춤 |
| `src/supervisor/dashboard.ts` | `POST /api/shutdown` 추가(`DashboardDeps.shutdown`). 이 파일은 **UTF-8이 아닌 바이트**가 있어 편집 도구가 거부한다 → 바이트 단위로 수정 |
| `src/supervisor/index.ts` | `stopAll()`을 만들어 `stop()`과 `shutdown`이 같이 쓰게 함 |

원본 `jarvis-ts`와 달리 `jarvis-cli`에는 `cli.ts` 외 진입점이 없다. `serve`는 `main.ts`를 import하고, supervisor는 `main.js`(빌드된 경우)를 자식 프로세스로 띄운다.

## 제약과 전제
- Node 22 이상. 도구가 PowerShell을 쓰므로 **Windows에서만 검증**했다(macOS/Linux는 `pwsh` 필요, 미검증).
- 터미널 출력은 Windows Terminal·VS Code(24비트), 그 외(256색)를 가정한다. `NO_COLOR`를 따른다.
- AI 모델 연동(대화형 에이전트)은 **없다.** 사람이 도구를 고르거나 입력한다. 요청이 있으면 별도 작업.
