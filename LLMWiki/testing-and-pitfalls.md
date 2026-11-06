# 검증 방법과 함정

## 테스트 구성 (`npm test`, 18개)
| 파일 | 무엇을 본다 |
|---|---|
| `test/cliutil.test.ts` | 인자 파싱(플래그·위치·불리언), 따옴표 토큰화, 오타 제안, 결과 렌더링, 테마·그라데이션·크기 표시 |
| `test/tui.test.ts` | 메뉴(화살표·필터·Ctrl+C), 자동 제안·입력 박스 하단 테두리가 그려지고 Enter에서 지워지는지, 스피너가 터미널이 아니면 투명한지 — **가짜 TTY(PassThrough)** 사용 |
| `test/admin.test.ts` | dirs/permissions/allowlist(저장·즉시 반영·거부 규칙), 감시 프로세스가 없을 때, **가짜 대시보드(http 서버)**로 401 설명·터널 재시작 |

단위 테스트가 통과해도 **실제 터미널에서 틀릴 수 있다**(예: 입력창 아래 안내 줄). TTY 동작은 아래 방법으로 직접 눌러 본다.

## 실제 터미널(Windows)에서 시험하기
- `winpty -Xallow-non-tty node dist/cli.js`를 파이썬 `subprocess`로 띄우고 키를 보낸다: ↓ `\x1b[B`, Enter `\r`, Ctrl+C `\x03`, Ctrl+U(줄 지우기) `\x15`. 출력에서 ANSI를 지우고 `<<<구간>>>` 표시를 넣어 화면별로 읽는다.
- 끝날 때 나오는 `winpty ... Assertion failed ... winpty.cc`는 **하네스 쪽 문제**이고 jarvis와 무관하다.
- winpty는 색 코드를 변환하므로 **색·그라데이션은 여기서 못 본다.** `FORCE_COLOR=1 COLORTERM=truecolor node -e`로 `cliutil`을 직접 불러 이스케이프를 확인한다.
- 이 하네스는 한국어 로케일의 80칸 콘솔이라, `…`·`·`·`●`·`○`가 2칸 폭으로 그려지는 환경을 흉내 낸다 → 줄 꺾임 시험에 유용.

## 서버를 시험할 때의 규칙 (중요)
사용자의 PC에는 **jarvis-ts가 8765/8766에서 이미 실행 중**일 수 있다. 시험은 그것을 건드리면 안 된다.
- 임시 폴더를 `JARVIS_HOME`으로 지정하고 그 안 `.env`에 `PC_MCP_PORT=18765`, `JARVIS_DASHBOARD_PORT=18766`, `JARVIS_TUNNEL=off`, `PC_MCP_ALLOWED_DIRS=<임시 폴더>`를 적는다. **대시보드 포트는 환경변수가 아니라 `.env` 파일에서만 읽는다.**
- 끝나면 `jarvis stop`으로 정리하고 `netstat`으로 18765/18766이 비었는지, 8765/8766의 PID가 그대로인지 확인한다.
- 기본 포트에 `start`를 시험하지 않는다. 지금은 401 안내와 "이미 실행 중" 처리가 있어 안전하지만, 실제 서비스에는 읽기 전용 조회만 한다.

## 함정 모음
| 함정 | 증상 | 대응 |
|---|---|---|
| PowerShell 5.1 `Set-Content -Encoding UTF8` | 파일 앞에 BOM → `package.json` 파싱 실패, 버전 `0.0.0-unknown` | JSON·Markdown은 파이썬이나 편집 도구로 고친다. 이미 붙었으면 `\xef\xbb\xbf`를 제거 |
| 셸 here-doc 속 파이썬 문자열 | `\\n`, `\\x1b`가 한 단계 풀려서 줄바꿈·ESC 문자가 소스에 들어가거나 치환이 안 맞음(`assert count == 1` 실패) | 치환 스크립트는 **파일로 써서** 실행한다. README의 `C:\path\to`가 탭으로 깨진 것도 같은 원인 |
| `process.exit` 직전의 `fetch` 연결 | Windows에서 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, 종료 코드 127 | 관리 명령은 `node:http`(`agent:false`)를 쓰고 자연 종료 |
| readline의 다시 그리기 | 커서 **아래**에 그린 것이 키 입력·프롬프트마다 지워짐 | 아래에 그리는 것은 키마다 다시 그린다. 정적인 안내는 위에 둔다 |
| East Asian ambiguous width | 한국어 콘솔에서 `…·●○`가 2칸 → 상태 줄·테두리가 꺾임 | 폭 계산에서 이 글자 수만큼 뺀다 |
| 복사한 `supervisor/dashboard.ts`의 비UTF-8 바이트 | 편집 도구가 파일 수정을 거부 | 파이썬으로 바이트 단위 치환(`rb`/`wb`, CRLF 유지) |
| 환경변수 `PC_MCP_EXTRA_ALLOWED_COMMANDS` | 설정 파일에 없는 허용 명령이 `allowlist`에 보임 | 설정 로더가 환경변수를 먼저 읽고 파일이 덮어쓴다. 정상 |
| 도구 실패가 `isError` 없이 `{"error":...}` | 종료 코드 0 | 텍스트의 `error`와 0이 아닌 `exit_code`로 판단 |
| `npm install -g github:...` (npm 11) | 설치는 되는데 실행하면 임시 clone 경로를 못 찾음 | tarball URL |
| 대시보드 401 | 다른 설정 폴더로 뜬 Jarvis가 같은 포트를 점유 | 그걸 끄거나 `JARVIS_HOME`을 그쪽 데이터 폴더로 |
| 터널이 `error`로 남음 | `403 Proxy Token Expired` 반복 후 감시 프로세스가 포기 | `jarvis tunnel restart`. 로그는 설정 폴더의 `tunnel.log`·`supervisor.log` |
