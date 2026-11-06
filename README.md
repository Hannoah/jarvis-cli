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
$ jarvis shell                         # 대화형 모드 (Tab 완성·히스토리)
```

## 특징

- **도구 39개** — 파일 읽기/쓰기/수정, 검색, PowerShell 실행, 백그라운드 작업, Git, 코드 심볼, 웹 검색/페이지 읽기, Word·Excel·PowerPoint·PDF 읽기, 위키 메모리, 예약 작업, kubectl·Azure·Power Platform CLI.
- **안전 장치 내장** — 허용 폴더 밖 접근 차단, 터미널 명령 허용 목록, 수정 전 자동 백업(`undo_last_edit`), 모든 호출을 `audit.log`에 기록, 비밀 파일 읽기 차단.
- **사용하기 편한 출력** — 파일 내용은 그대로, 목록은 표, 명령 실행은 stdout/stderr 분리, 색상 지원. 파이프로 넘기면 원문 그대로 나와 스크립트에 쓰기 좋습니다.
- **셸 친화적** — 위치 인자, 오타 제안(`Did you mean`), 의미 있는 종료 코드, PowerShell/bash 자동 완성.
- **서버 없음** — 포트·터널·로그인 없이 터미널에서 바로 실행됩니다.

## 설치

필요한 것: **Node.js 22 이상**, Git. (도구가 PowerShell을 쓰므로 Windows 기준으로 개발·검증했습니다. macOS/Linux는 `pwsh`가 필요하며 아직 충분히 검증하지 못했습니다.)

### 방법 1 — 한 줄 설치 (추천)

```
npm install -g https://github.com/Hannoah/jarvis-cli/archive/refs/heads/main.tar.gz
jarvis version
```

빌드된 파일(`dist/`)이 저장소에 들어 있어 별도 빌드가 필요 없습니다. 업데이트는 같은 명령을 다시 실행하고, 제거는 `npm uninstall -g jarvis-cli`입니다. 특정 버전은 `refs/tags/v0.1.0.tar.gz`처럼 태그를 지정하세요.

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
jarvis shell                대화형 세션
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

`jarvis shell`은 도구 이름과 `--파라미터`를 Tab으로 완성하고, 방향키로 히스토리를 불러옵니다. `exit`로 종료합니다.

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

구조: `src/cli.ts`(진입점·명령) · `src/cliutil.ts`(인자 파싱·렌더링, 테스트 대상) · `src/tools/*`(도구) · `src/{core,files,security,system}`(설정·샌드박스·정책·백업). CLI는 도구를 MCP 서버 형태로 같은 프로세스 안에서 호출하므로, MCP 서버 구현을 그대로 재사용합니다.

## 라이선스

[MIT](LICENSE) © 2026 Hannoah
