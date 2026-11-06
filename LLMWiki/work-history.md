# 작업 히스토리

릴리스(버전)별로 **요청 → 한 일 → 함정/결정** 순으로 남긴다. 세부 변경은 git log, 배포 절차는 [release-runbook](release-runbook.md), 결정만 따로 보려면 [decision-log](decision-log.md).
날짜는 세션 날짜(2026-11-06) 기준이다. 새 작업은 맨 아래에 이어 쓴다.

---

## v0.1.0 — "jarvis-ts의 CLI 버전을 지금 프로젝트에"

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| jarvis-ts의 CLI 버전 만들기 | 형태를 물어서 **도구 직접 실행 CLI**(서버·터널·대시보드 제외)로 결정. `core/files/security/system/tools`와 `server/mcp·plugins`를 복사하고, SDK의 `InMemoryTransport`로 **같은 프로세스에서 MCP 서버를 호출**해 도구를 다시 구현하지 않음. `jarvis <tool> --arg`, 스키마 기반 형 변환 | 도구가 실패해도 `isError` 없이 `{"error":...}` 텍스트만 돌려줌 → 종료 코드가 0이었다. 텍스트의 `error`와 0이 아닌 `exit_code`를 보고 1로 처리. 일부 도구는 상대 경로를 작업 폴더 기준, 일부는 프로세스 cwd 기준으로 풀어서 `/cd`는 둘 다 바꾼다 |
| UI/UX와 CLI 기능 개선 | 색, 표, 오타 제안(Did you mean), 위치 인자(`read_file notes.txt 1 20`), PowerShell/bash 자동 완성, 단위 테스트 | 불리언 플래그 뒤의 값은 `true/false`만 값으로 먹는다(`--recursive src`에서 `src`를 먹지 않게) |
| GitHub(Hannoah)에 올리기, 다운로드 쉽게, README, MIT | 공개 저장소 생성, LICENSE, README | 원본이 비공개·LICENSE 없음임을 알렸고 사용자가 Public+MIT를 확인. **설치가 두 번 깨졌다**: ① `prepare: tsc`는 git 설치 때 `tsc`가 없어 실패 → `dist/`를 커밋. ② `npm install -g github:...`는 npm 11에서 설치 폴더가 지워질 임시 clone을 가리켜 실행 불가 → **tarball URL**. 두 번 다 게시된 것을 임시 폴더에 실제로 설치해 보고서야 발견했다 |
| (자체 발견) 전역 설치와 설정 폴더 | 기본 설정 폴더를 `~/.jarvis`로 | 설정을 프로그램 폴더(`node_modules` 안)에 두면 업데이트 때 설정·로그·백업이 지워진다 |

## v0.2.0 — 인터랙티브 입력창

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "claude code처럼 jarvis 한 번 입력하면 챗 라인과 메뉴" | 맨 `jarvis` = 입력창. `/` 메뉴(↑↓ + 글자 필터), `/tools`(카테고리 → 도구 → 필수 파라미터 질문 → 선택 항목 메뉴 → Run), `/cd`, Tab 완성, 히스토리, 파이프 입력 | 메뉴가 키보드를 독점해야 해서 **입력 한 줄마다 readline을 만들고 닫는다**(히스토리는 배열로 넘김). 파이프 입력은 매번 닫으면 버퍼가 사라져 stdin 전체를 한 번에 읽는다. 메뉴·입력 UI는 의존성 없이 직접 구현(`src/tui.ts`) |
| 배포 | 커밋·push·v0.2.0 | 사용자가 "배포 안된듯?"이라고 짚음 → 이후 지침(배포까지 자동) |

## v0.3.0 — MCP 서버 모드와 Claude Code 스타일 명령

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "이게 결국 로컬 MCP Server 띄우는 게 일상 기능" | jarvis-ts의 `supervisor/`·`server/http.ts`·`main.ts`를 가져와 `start/serve/open/url/install/uninstall` | **계기:** 전역 `jarvis`가 jarvis-cli(서버 명령 없음)로 바뀌어 있었다. 시험은 jarvis-ts가 이미 8765/8766을 쓰고 있어서 **임시 설정 폴더 + 임시 포트 + `--no-tunnel`**로 했다. 대시보드 포트는 환경변수가 아니라 **`.env` 파일에서만** 읽는다는 걸 처음 시험에서 잘못 겪었다 |
| "clear도 쓰게, Claude CLI와 비슷한 명령 구성" | `/help /clear /status /doctor /permissions /add-dir /config /memory /mcp /exit`, `!명령`(= `run_terminal`, 같은 정책), 슬래시 없는 `clear/help/exit` | 입력창 **아래** 안내 줄은 readline이 다시 그릴 때마다 커서 아래를 지워서 보이지 않았다 → 위로 옮김 |

## v0.4.0 — 서버 제어·접근 관리·MCP 정보·UI 강화

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "승인된 경로, 접근 권한, allowlist 갱신", "MCP Connection 정보", "서버 실행 종료" | `dirs / permissions / allowlist`(대시보드의 `applySettings` 재사용), `mcp`(info/key/config/copy/rotate), `start -d / stop / restart / status`(감시 프로세스의 대시보드 API) + `POST /api/shutdown` 추가, 인자 없이 치면 메뉴 | 종료 직전 `fetch` 연결이 남은 채 `process.exit`을 부르면 **Windows에서 libuv assertion(종료 코드 127)** → `node:http`(`agent:false`)로 바꾸고 자연 종료. 빈 승인 폴더 목록은 홈 전체로 대체되므로 거부. `allowlist add`에서 `powershell`·`cmd` 같은 범용 실행기와 blocklist 전환은 `--yes` 필요 |
| "UI/UX 좀 더 강화" | 상태 줄(폴더·MCP 상태·정책), 입력 중 자동 제안, 둥근 메뉴 패널, 스피너와 실행 시간 | 제안은 readline이 아래를 지우므로 **키마다 다시 그린다**. 한국어 콘솔은 `…·●○`를 2칸 폭으로 그려 줄이 꺾였다 → 폭에 3칸 여유 |
| (자체 발견) | — | `Set-Content -Encoding UTF8`(PowerShell 5.1)이 `package.json`에 BOM을 붙여 `jarvis version`이 `0.0.0-unknown`. README에는 파이썬 이스케이프로 `C:\path\to`가 탭 문자로 깨짐 |
| 배포 지침 | "당연히 무조건 배포까지 해 앞으로는" | 이후 작업은 확인 없이 커밋·push·릴리스·설치 검증까지 한다 |

## v0.5.0 — fancy 인터페이스

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "cli 인터페이스 개선 fancy하게" | `JARVIS` 로고(테마 그라데이션), **입력 박스**(위 테두리 = 상태 줄, 아래 테두리 = 주요 명령), 도구 실행 **카드**(`● 도구  --옵션`, 왼쪽 `│`, `╰ ✔ 18ms`), `/theme` 6종(`JARVIS_THEME` 저장), 파일 표(크기 `1.5 KB`, 폴더 강조) | 박스 아래 테두리는 입력 제안과 같은 방식(키마다 다시 그림 + 첫 프레임에도)으로 그린다. 시험 하네스(winpty)가 색을 변환해서 **그라데이션은 눈으로 못 봤고** 색 코드 생성만 따로 확인했다 |

## v0.5.1 — "HTTP 401 스타트 했는데 이 에러나와"

| 증상 | 원인 | 고침 |
|---|---|---|
| `jarvis start -d`·`/start`·`status`가 `✖ HTTP 401` | **jarvis-ts가 8766을 쓰고 있었고**, 설정 폴더 `~/.jarvis`에는 예전에 `start`가 포트 충돌로 실패하면서 남긴 `.dashboard_token`이 있었다. 그 토큰으로 다른 설정 폴더의 대시보드에 물어 거부됨 | 401을 "다른 설정 폴더로 뜬 Jarvis"로 설명하고 해결법(그걸 끄거나 `JARVIS_HOME`을 그쪽 데이터 폴더로)을 알려 줌. 대시보드 포트가 이미 점유돼 있으면 `start -d`는 spawn하지 않음. 포그라운드 `start`는 거부될 URL을 열지 않음. 재현 → 수정 → **같은 명령을 실제 인스턴스에 다시 실행**해 확인. `JARVIS_HOME`을 jarvis-ts 데이터 폴더로 지정하면 실제 인스턴스를 인증해 조회됨(읽기 전용으로만 확인) |

## v0.6.0 — 터널 명령 (이어서 진행)

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "작업 하던 거 이어서 진행도 하고" | 위 조회에서 사용자 인스턴스의 터널이 `error`였던 것을 읽기 전용으로 조사 → `jarvis tunnel [status\|start\|stop\|restart]`와 `/tunnel`, `status`·`mcp`가 터널 오류와 해결법을 안내 | **관측:** 2026-11-05 21:21경 `403 Proxy Token Expired` 반복 → 터널 호스트가 종료 코드 1로 5회 넘게 재시작 → 감시 프로세스가 포기, `error`로 남음. devtunnel 로그인은 유효했다. 외부 접속(Copilot Studio 등)이 끊겨 있었을 가능성이 크다. **사용자의 실행 중 서비스는 요청 없이 재시작하지 않았다.** 해결 명령만 만들어 안내. 같은 작업 중 `status`가 터널 상태 `running`으로 비교하던 버그 발견(실제 이름은 `online`) → 수정 |
| "LLMWiki 하나 만들어서 작업 히스토리 관리" | 이 위키(`LLMWiki/`) 생성. 이 PC의 다른 프로젝트 위키 형식(`index` / `project-context` / `work-history` / `decision-log`)을 따름 | 공개 저장소에 올라가므로 토큰·이메일·로컬 경로는 넣지 않았다 |
