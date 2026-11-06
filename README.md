# Jarvis CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

**내 PC의 파일·터미널·Git·웹·위키 도구 39개를, 허용한 폴더 안에서만 안전하게 쓰는 명령줄 프로그램.**
*39 sandboxed PC tools (files, terminal, git, web, wiki, …) as a single command-line program.*

```console
# 예시 출력
$ jarvis list_files src
directory=C:\work\app\src  pattern=*  recursive=false  count=3
path        type  size_bytes  modified
cli.ts      file  8068        2026-11-06 10:35:17
core        dir   -           2026-11-06 10:26:01
tools       dir   -           2026-11-06 10:26:02

$ jarvis read_file notes.txt 1 20      # 위치 인자
$ jarvis git_status                    # 구조화된 Git 상태
$ jarvis                               # 대화형 모드 (입력창·/ 메뉴·도구 폼)
```

## 특징

- **도구 39개** — 파일 읽기/쓰기/수정, 검색, PowerShell 실행, 백그라운드 작업, Git, 코드 심볼, 웹 검색/페이지 읽기, Word·Excel·PowerPoint·PDF 읽기, 위키 메모리, 예약 작업, kubectl·Azure·Power Platform CLI.
- **안전 장치 내장** — 허용 폴더 밖 접근 차단, 터미널 명령 허용 목록, 수정 전 자동 백업(`undo_last_edit`), 모든 호출을 `audit.log`에 기록, 비밀 파일 읽기 차단.
- **사용하기 편한 출력** — 파일 내용은 그대로, 목록은 표, 명령 실행은 stdout/stderr 분리, 색상 지원. 파이프로 넘기면 원문 그대로 나와 스크립트에 쓰기 좋습니다.
- **대화형 입력창** — `jarvis`만 입력하면 `/` 메뉴와 단계별 도구 폼이 있는 터미널 UI가 열립니다.
- **셸 친화적** — 위치 인자, 오타 제안(`Did you mean`), 의미 있는 종료 코드, PowerShell/bash 자동 완성.
- **두 가지 사용 방식** — 터미널에서 도구를 직접 실행하거나(서버 불필요), 같은 도구를 **로컬 MCP 서버**(Dev Tunnel + 웹 대시보드)로 띄워 Copilot Studio·Claude·Cursor 같은 AI 클라이언트에 연결할 수 있습니다.

## 설치

필요한 것: **Node.js 22 이상**, Git. (도구가 PowerShell을 쓰므로 Windows 기준으로 개발·검증했습니다. macOS/Linux는 `pwsh`가 필요하며 아직 충분히 검증하지 못했습니다.)

### 방법 1 — 한 줄 설치 (추천)

```
npm install -g https://github.com/Hannoah/jarvis-cli/archive/refs/heads/main.tar.gz
jarvis version
```

빌드된 파일(`dist/`)이 저장소에 들어 있어 별도 빌드가 필요 없습니다. 업데이트는 같은 명령을 다시 실행하고, 제거는 `npm uninstall -g jarvis-cli`입니다. 특정 버전은 `refs/tags/v0.5.0.tar.gz`처럼 태그를 지정하세요.

> `npm install -g github:Hannoah/jarvis-cli` 형태는 쓰지 마세요. npm 11에서 전역 설치 시 임시 폴더로 링크가 걸려 실행이 깨집니다.

### 방법 2 — 소스를 받아서

```
git clone https://github.com/Hannoah/jarvis-cli.git
cd jarvis-cli
npm install          # 의존성 설치 (빌드된 dist/ 포함)
npm link             # `jarvis` 명령 등록
```

Git이 없으면 [ZIP으로 받아](https://github.com/Hannoah/jarvis-cli/archive/refs/heads/main.zip) 압축을 풀고 `npm install && npm link`를 실행하세요. 등록 없이 쓰려면 `node dist/cli.js <도구>`.

### 자동 완성 (선택)

```powershell
# PowerShell — $PROFILE에 넣으면 영구 적용
jarvis completion powershell | Out-String | Invoke-Expression
```
```bash
# bash
jarvis completion bash >> ~/.bashrc
```

도구 이름이 스크립트에 들어가므로 업데이트 후에는 다시 생성하세요.

## 사용법

```
jarvis <tool> [args]        도구 실행
jarvis list [filter]        도구 목록 (이름·설명으로 필터)
jarvis help <tool>          파라미터와 사용법 (= jarvis <tool> --help)
jarvis                      대화형 모드 (= jarvis shell)
jarvis completion <powershell|bash>
```

### 인자 넘기기

```
jarvis read_file --path notes.txt --start_line 1 --max_lines 20   # 이름으로
jarvis read_file notes.txt 1 20                                    # 위치로 (필수 → 선택, 스키마 순서)
jarvis list_files src --recursive                                  # 불리언은 플래그만
jarvis wiki_append --json '{"slug":"todo","content":"- 우유 사기"}' # JSON으로 한 번에
jarvis run_terminal "Get-Date -Format o"
```

- 값은 도구 스키마에 맞춰 자동 변환됩니다. 배열·객체는 JSON으로 넘깁니다.
- 상대 경로는 **현재 폴더** 기준입니다(현재 폴더가 허용 폴더 안일 때). 아니면 기본 작업 폴더를 씁니다.

### 출력과 종료 코드

| 상황 | 동작 |
|---|---|
| 터미널 | 표·색상·들여쓴 JSON으로 읽기 좋게 표시 |
| 파이프/리다이렉트 | 도구의 원문 텍스트 그대로 (`jarvis list_files . \| jq ...`) |
| `--raw` | 터미널에서도 원문 강제 |
| `NO_COLOR=1` | 색상 끔 |

종료 코드: `0` 성공 · `1` 도구 오류(`error` 응답, 0이 아닌 `exit_code` 포함) · `2` 필수 인자 누락.

### 대화형 모드

터미널에서 `jarvis`만 입력하면 입력창이 열립니다. (로고는 실제 터미널에서 테마 색 그라데이션으로 표시됩니다.)

```
  ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
  ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
  ██║███████║██████╔╝██║   ██║██║███████╗
██╗██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
 ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
  v0.5.0  ·  ~\Work\app
  39 tools · 4 folders · allowlist · MCP ● running
  tip: /tools walks you through any tool's parameters, step by step.

╭─ ~\Work\app ─────────────────────── MCP ● running · allowlist ─╮
│ ❯ read_file package.json 1 2
╰─ / menu · /help · /status · /mcp · /permissions · /theme · /exit ─╯
● read_file  --path package.json --start_line 1 --max_lines 2
│ path=C:\Work\app\package.json  encoding=utf-8  total_lines=52  start_line=1  end_line=2
│ {
│   "name": "jarvis-cli",
╰ ✔ 11ms
```

- **도구 바로 실행:** `read_file notes.txt`, `git_status`, `help read_file` — 한 줄 모드와 같은 문법입니다.
- **`/` 명령 메뉴:** `/`만 입력하면 메뉴가 열립니다. ↑↓로 이동, 글자를 입력하면 필터링, Enter로 선택, Esc로 취소합니다.
- **`/tools`:** 카테고리 → 도구를 고르면 파라미터를 하나씩 물어보고, 선택 항목은 메뉴에서 추가한 뒤 `▶ Run`으로 실행합니다. 실행된 카드의 헤더에 같은 동작의 한 줄 명령 옵션(`--path ...`)이 표시됩니다.
- **`!명령`:** Claude Code의 bash 모드처럼 `!git status`는 `run_terminal`로 셸 명령을 실행합니다(샌드박스·명령 정책 동일 적용).
- **`clear`:** 슬래시 없이 `clear`(또는 `cls`)로 화면을 지웁니다. `help`, `exit`도 슬래시 없이 됩니다. Ctrl+L도 됩니다.
- **입력 박스:** 위쪽 테두리가 상태 줄입니다(현재 폴더, MCP 서버 ● 실행 중 / ○ 중지, 접근 정책 `allowlist`·`write off` 등, 매번 갱신). 아래쪽 테두리에는 주요 명령이 항상 보입니다.
- **입력 중 자동 제안:** `/`나 도구 이름 일부(두 글자 이상)를 입력하면 아래에 일치하는 명령·도구가 설명과 함께 나타나고, `read_file `처럼 도구 이름 뒤에 공백을 넣으면 그 도구의 사용법이 나타납니다. Tab으로 완성합니다.
- **도구 실행 카드:** 실행하면 `● 도구  --옵션` 헤더, 왼쪽 세로선(`│`)이 붙은 결과, `╰ ✔ 18ms` 결과 줄로 표시됩니다. 0.25초 넘게 걸리면 스피너와 경과 시간이 나옵니다. 목록 표는 크기를 `1.5 KB`처럼 읽기 쉽게 보여주고 폴더를 강조색으로 표시합니다.
- **메뉴 패널:** 둥근 테두리 패널에서 ↑↓로 이동하고, 글자를 입력하면 필터링되며, 항목이 많으면 `↑ n more`/`↓ n more`와 현재 위치(`3/19`)를 보여줍니다. PgUp/PgDn/Home/End도 됩니다.
- **테마:** `/theme`으로 강조색을 고릅니다(`blue` 기본, `violet`, `emerald`, `amber`, `rose`, `mono`). 설정 파일의 `JARVIS_THEME`에 저장되고 로고 그라데이션, 테두리, 메뉴 강조에 적용됩니다.
- **색상 지원:** 24비트 색을 지원하는 터미널(Windows Terminal, VS Code 등)에서는 24비트로, 그 외에는 256색으로 표시합니다. `NO_COLOR=1`이면 끕니다. 시작·종료·재시작 중에도 스피너가 나오고, 터미널 제목에 현재 폴더가 표시되며, `jarvis list`는 터미널에서 카테고리별로 묶어 보여줍니다.
- 한국어 Windows 콘솔처럼 `…`, `·`, `●` 같은 기호를 2칸 폭으로 그리는 터미널에서도 줄이 꺾이지 않도록 테두리 폭에 여유를 둡니다.

슬래시 명령 (Claude Code와 같은 이름을 우선 사용):

| 명령 | 설명 |
|---|---|
| `/help` | 사용법 (셸에서 쓰는 서버 명령 포함) |
| `/clear` | 화면 지우기 |
| `/status` | 버전, 작업 폴더, 허용 폴더, 접근 정책, MCP 서버 실행 여부 (`/env`도 같음) |
| `/doctor` | Node, PowerShell, git, devtunnel, kubectl 등 준비 상태 점검 |
| `/permissions` | 읽기·쓰기·터미널 스위치와 터미널 모드를 메뉴로 켜고 끄기 (바로 저장) |
| `/dirs` | 승인된 폴더 목록·추가·제거 (바로 저장). `/add-dir <폴더>`는 추가의 단축형 |
| `/allowlist` | 터미널 허용 명령 목록·추가·제거·검사 (바로 저장) |
| `/mcp` | MCP 연결 정보(주소, API 키, 클라이언트 설정) 보기와 복사 |
| `/start` `/stop` `/restart` | MCP 서버(+터널+대시보드)를 백그라운드로 실행 / 종료 / 서버 재시작 |
| `/config` | 설정 파일 보기(API 키 등은 `********`로 가림), `/config edit`로 편집기 열기 |
| `/theme [이름]` | 강조색 테마 선택 (바로 저장) |
| `/memory` | 위키 메모리 색인 |
| `/tools` | 카테고리 → 도구 선택 → 파라미터 폼 |
| `/list [필터]` | 도구 목록 |
| `/cd [폴더]` | 작업 폴더 변경 (허용 폴더 안에서만) |
| `/version` | 버전 |
| `/exit` | 종료 (`/quit`, Ctrl+D) |

- **편의:** Tab으로 도구 이름·`--옵션`·`/명령` 완성, ↑↓로 이전 입력, Ctrl+C를 두 번 누르면 종료.
- 파이프로 명령을 넘기면(`"git_status" | jarvis shell`) 메뉴 없이 한 줄씩 실행합니다.

## MCP 서버로 쓰기

AI 클라이언트(Copilot Studio, Claude, Cursor 등)가 내 PC의 도구를 쓰게 하려면 서버를 띄웁니다.

### 실행과 종료

```
jarvis start -d             # 백그라운드로 실행: 터미널이 비어 있음 (--background도 가능)
jarvis start                # 포그라운드로 실행: MCP 서버 + Dev Tunnel + 웹 대시보드를 감시·자동 복구 (Ctrl+C로 종료)
jarvis status               # 감시 프로세스, MCP 서버(PID·가동 시간), 터널 상태
jarvis restart              # MCP 서버만 재시작 (저장한 설정을 반영할 때)
jarvis stop                 # MCP 서버·터널·대시보드를 모두 종료
jarvis start --no-tunnel    # 터널 없이 (로컬에서만 접속)
jarvis start --no-open      # 대시보드를 브라우저로 열지 않음
jarvis serve                # MCP 서버만 127.0.0.1에 실행 (감시·터널 없음)
jarvis open | jarvis url    # 대시보드 열기 / 주소 출력 (로그인 토큰 포함)
jarvis install              # 로그인할 때 자동 시작 (작업 스케줄러 / LaunchAgent / systemd)
jarvis uninstall
```

`jarvis` 입력창 안에서는 `/start`, `/stop`, `/restart`, `/status`로 같은 일을 합니다. `stop`·`restart`·`status`는 실행 중인 감시 프로세스의 대시보드 API를 통해 동작하며, 대시보드 토큰은 설정 폴더의 `.dashboard_token`을 사용합니다.

### MCP 연결 정보

```
jarvis mcp                   # HTTPS 주소(터널), 로컬 주소, API 키(일부만 표시), 인증 방식, OAuth 정보
jarvis mcp key               # API 키 전체 출력 (화면에 노출됨에 주의)
jarvis mcp copy url|key      # 클립보드로 복사 (화면에 출력하지 않음)
jarvis mcp config claude     # Claude Code 등록 명령 (키는 <API_KEY> 자리표시자)
jarvis mcp config cursor     # Cursor mcp.json 설정
jarvis mcp copy claude       # 키를 포함한 설정을 클립보드로 복사
jarvis mcp rotate --yes      # API 키 재발급 (기존 클라이언트는 모두 새 키로 바꿔야 함)
```

- 인증은 `X-API-Key: <키>` 또는 `Authorization: Bearer <키>` 헤더입니다.
- Copilot Studio처럼 OAuth 2.0(수동)을 쓰는 곳에는 `jarvis mcp`가 보여주는 값을 넣습니다. 클라이언트 ID는 `pc-mcp-client`, 클라이언트 시크릿은 API 키이고, authorize/token 주소는 터널 주소 아래 `/oauth/authorize`, `/oauth/token`입니다.
- 입력창에서는 `/mcp`만 입력하면 현재 정보를 보여준 뒤 복사·재발급 메뉴가 열립니다.

### 승인 폴더·접근 권한·허용 명령

변경은 설정 파일에 바로 저장되고 현재 입력창에도 즉시 반영됩니다. 이미 실행 중인 MCP 서버에는 `jarvis restart` 후 적용됩니다. 입력 검증은 대시보드와 같은 코드를 씁니다.

```
jarvis dirs                          # 승인된 폴더 목록
jarvis dirs add <폴더>               # 폴더 승인 (드라이브 루트나 없는 폴더는 거부)
jarvis dirs remove <폴더>            # 승인 해제 (마지막 하나는 지울 수 없음)

jarvis permissions                   # 읽기·쓰기·터미널·터미널 모드 현재 상태
jarvis permissions write off         # read | write | terminal 을 on | off
jarvis permissions mode blocklist --yes   # allowlist(기본, 안전) | blocklist(--yes 필요)

jarvis allowlist                     # 기본 허용 명령 수와 내가 추가한 명령
jarvis allowlist add <명령...>       # 허용 명령 추가 (powershell·cmd 같은 범용 실행기는 --yes 필요)
jarvis allowlist remove <명령...>    # 내가 추가한 명령 제거 (기본 허용 명령은 제거 불가)
jarvis allowlist check "git status"  # 실제 정책으로 검사만 하기 (실행하지 않음, 감사 로그에도 남기지 않음)
```

입력창에서는 `/dirs`, `/permissions`, `/allowlist`를 인자 없이 입력하면 현재 상태 아래에 메뉴가 열립니다(항목 선택으로 토글·추가·제거).

> 이 설정은 Jarvis를 쓰는 사람이 직접 바꾸는 것입니다. AI 도구는 설정 파일을 읽거나 쓸 수 없습니다.

### 참고

- 포트: MCP `8765`(`/mcp`, API 키 필요), 대시보드 `8766`(이 PC에서만 접속, 토큰 보호). 둘 다 `127.0.0.1`에만 바인딩합니다.
- 이미 실행 중이면 오류 대신 기존 대시보드를 열어 줍니다.
- 외부 접속은 [Dev Tunnel](https://learn.microsoft.com/azure/developer/dev-tunnels/) CLI(`devtunnel`)를 씁니다. 없으면 Windows에서는 winget으로 설치를 시도합니다.
- 서버 설정·API 키·OAuth 토큰·로그는 설정 폴더(`~/.jarvis`)에 저장됩니다. **jarvis-ts를 이미 쓰고 있다면** 키와 터널 주소가 새로 만들어지지 않도록 같은 폴더를 가리키세요.
  ```powershell
  $env:JARVIS_HOME = "C:\path\to\jarvis-ts\data"   # 영구 적용: setx JARVIS_HOME ...
  ```
- jarvis-ts와 **동시에** 실행하면 같은 포트(8765/8766)를 쓰므로 한쪽만 실행하세요.
- 서버를 외부에 열면 이 PC의 파일·터미널 권한이 API 키 하나로 보호됩니다. 아래 [보안 모델](#보안-모델)의 한계를 꼭 읽으세요.

## 도구 목록

| 분류 | 도구 |
|---|---|
| 환경 | `get_pc_env` `get_system_status` |
| 파일 | `read_file` `write_file` `edit_file` `list_files` `search_in_files` `read_document` |
| 백업 | `undo_last_edit` `list_file_backups` `restore_file_backup` |
| 터미널 | `run_terminal` `start_background_job` `read_job_output` `stop_job` `list_background_jobs` |
| Git | `git_status` `git_diff` `git_log` `git_commit` |
| 코드 | `list_code_symbols` |
| 웹 | `search_web` `fetch_web_page` |
| 위키 메모리 | `wiki_index` `wiki_search` `wiki_read` `wiki_append` `wiki_create` |
| 시스템 | `open_in_default_app` `manage_clipboard` `send_notification` |
| 예약 작업 | `schedule_task` `list_scheduled_tasks` `delete_scheduled_task` |
| 엔터프라이즈 CLI | `run_kubectl` `run_azure_cli` `run_pac_cli` `run_viya_cli` `deploy_viya_status_page` |

각 도구의 파라미터는 `jarvis help <tool>`로 확인하세요.

## 보안 모델

Jarvis는 **PC를 조작하는 도구**입니다. 아래 한계를 알고 쓰세요.

- **허용 폴더 샌드박스** — 파일 도구와 터미널 작업 폴더는 허용 폴더 안으로 제한됩니다. 기본값은 `~/Work`, `Desktop`, `Downloads`, `Documents`.
- **터미널 허용 목록** — `run_terminal`은 기본적으로 허용된 명령만 실행합니다(`allowlist`). 모든 명령은 실행 전에 정책 검사를 통과해야 합니다.
- **자동 백업과 감사 로그** — 수정 전에 스냅샷을 남기고, 모든 도구 호출은 `~/.jarvis/audit.log`에 기록됩니다.
- **비밀 보호** — Jarvis 자신의 설정·토큰 파일은 읽고 쓸 수 없습니다.
- **한계** — 허용 목록 안의 명령(`git`, `az`, `kubectl` 등)은 그 도구가 가진 권한 그대로 동작합니다. 샌드박스는 실수를 줄이는 장치이지 악의적인 코드를 격리하는 보안 경계가 아닙니다. 신뢰하지 않는 입력으로 도구를 호출하지 마세요.

## 설정

설정 폴더는 `~/.jarvis`(Windows는 `%USERPROFILE%\.jarvis`)이며 `JARVIS_HOME` 환경 변수로 바꿀 수 있습니다. 같은 폴더의 `.env`에서 동작을 조정합니다.

```ini
# 허용 폴더 (';' 구분, ~ 와 %USERPROFILE% 사용 가능). 비우면 자동 감지.
PC_MCP_ALLOWED_DIRS=C:\Users\me\Work;C:\Users\me\Documents

# MCP 포트 (기본 8765) / 대시보드 포트 (기본 8766)
# PC_MCP_PORT=8765
# JARVIS_DASHBOARD_PORT=8766

PC_MCP_ENABLE_READ=true
PC_MCP_ENABLE_WRITE=true
PC_MCP_ENABLE_TERMINAL=true

# allowlist(권장) | blocklist
PC_MCP_TERMINAL_MODE=allowlist
# 허용 목록에 명령 추가 (';' 구분)
PC_MCP_EXTRA_ALLOWED_COMMANDS=Start-Process;Stop-Process
```

## 개발

```
npm install
npm run dev -- list      # tsx로 바로 실행
npm run build      # src → dist (dist/는 커밋 대상이므로 변경 후 반드시 실행)
npm test           # 인자 파싱·렌더링 단위 테스트
npm run typecheck
```

구조: `src/cli.ts`(진입점·명령) · `src/supervisor/`·`src/server/http.ts`·`src/main.ts`(MCP 서버·터널·대시보드) · `src/cliutil.ts`(인자 파싱·렌더링, 테스트 대상) · `src/tui.ts`(메뉴·입력 프롬프트) · `src/tools/*`(도구) · `src/{core,files,security,system}`(설정·샌드박스·정책·백업). CLI는 도구를 MCP 서버 형태로 같은 프로세스 안에서 호출하므로, MCP 서버 구현을 그대로 재사용합니다.

## 라이선스

[MIT](LICENSE) © 2026 Hannoah
