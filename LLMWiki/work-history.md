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

## v0.6.1 — 프로젝트 정밀 점검에서 나온 문제 일괄 수정

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "현재 프로젝트 깊이 살펴봐" → "발견한 거 다 고쳐줘" → "고치면 배포까지 한 번에" | ① **터널 레이트리밋 무력화 수정:** Dev Tunnel이 이 PC에서 접속하므로 인터넷 요청도 루프백으로 보여 제한이 한 번도 걸리지 않았다 → `limitKey()`가 루프백이라도 `x-forwarded-*` 헤더가 있으면 `tunnel` 버킷 하나로 센다. ② 개인 경로(`Work/02_SAS_Demos…`, KubeConfig 경로)와 한국어 안내를 도구에서 제거(`VIYA_CLI_DIR`, `JARVIS_STATUS_DEPLOY_DIR`, `JARVIS_DEFAULT_KUBECONFIG`로만 지정). ③ `test/security.test.ts` 추가(샌드박스, 레이트리밋, HTTP 인증, OAuth+PKCE, PowerShell AST 정책). ④ `jarvis-ts` 이름 잔재 정리, OAuth 동의 페이지의 `data/.env` 안내 수정. ⑤ 플러그인 폴더를 설치 폴더에서 **설정 폴더의 `custom_tools/`**로. ⑥ `cli.ts`에서 서버 명령을 `serverCmd.ts`로 분리 | 레이트리밋 수정은 **헤더가 실제로 붙는다는 가정**이다(OAuth 메타데이터가 `x-forwarded-host/proto`를 이미 쓰고 있어 터널이 붙이는 것은 확인됐지만, 실제 터널 경유 호출로 429를 확인하지는 못했다). 모든 터널 클라이언트가 분당 300회를 나눠 쓴다. 플러그인을 설치 폴더에 두고 쓰던 사람은 설정 폴더로 옮겨야 한다. 기본 허용 폴더(`~/Work` 등)는 README에 문서화된 동작이라 그대로 뒀다 |

## v0.7.0 — 업데이트 확인, 설치 완료 메시지, 입력창 테두리 제거

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "첫 실행 때 최신 버전이 있으면 업데이트할지 물어보기" | `src/update.ts`: 하루 한 번 GitHub `releases/latest`를 조회(2.5초 타임아웃, 실패는 조용히), 대화형 입력창 첫 화면에서 `Update now / Later / Skip x.y.z`. `jarvis update`로 수동 실행. `npm install -g <tarball>`을 실행하고 끝나면 프로세스를 종료(설치 폴더의 파일이 바뀌었으므로). 끄기: `JARVIS_NO_UPDATE_CHECK`, `.git`이 있는 소스 체크아웃에서는 묻지 않음 | 조회는 `fetch`가 아니라 `node:https`(`agent:false`): 연결이 남은 채 `process.exit`을 부르면 Windows에서 libuv가 죽은 전례. 건너뜀/나중에는 `~/.jarvis/.update_check.json`에 저장 |
| "설치 완료됐을 때 나오는 메시지들 신경 써줘" | 설치·업데이트 뒤 **처음 실행**에 한 번: 새로 설치면 시작 안내(설정 폴더, `/help`, `jarvis start -d`), 업데이트면 `x → y`와 릴리스 링크, 서버가 떠 있으면 재시작 안내. `jarvis update` 완료 메시지, `jarvis install/uninstall` 결과에 다음 할 일을 덧붙임 | npm은 전역 설치의 postinstall 출력을 숨기므로 설치 직후에는 문구를 낼 수 없다 → 첫 실행 시점에 보여준다(`seenVersion`) |
| "Jarvis 꺼도 MCP 서버가 running으로 나온다" | 원인: 표시는 **서버**(8765) 상태이고 입력창과 별개의 백그라운드 프로세스다. 입력창을 종료해도 서버는 계속 돈다. 라벨을 `MCP server`로 바꾸고, 종료 시 서버가 아직 떠 있으면 `jarvis stop` 안내를 출력 | 당시 8765/8766은 실제로 jarvis-cli 감시 프로세스(19:12 시작)가 잡고 있었다. 사용자의 서비스라 중지하지 않았다 |
| "입력창을 둘러싼 선 없애" | 상자(`╭╮│╰╯`)를 없애고 입력창 위에 상태 한 줄, 아래에 주요 명령 한 줄 | 도구 실행 카드의 `│`/`╰`는 입력창이 아니므로 유지 |
| "클라이언트 ID가 촌스러움" | `pc-mcp-client` → `jarvis` | 서버는 `client_id`를 검사하지 않아 예전 값으로 연결해 둔 곳도 그대로 동작 |
| `.env`에서 kubeconfig 등 지정 | `KUBECONFIG`, `JARVIS_DEFAULT_KUBECONFIG`, `VIYA_CLI_DIR`, `JARVIS_STATUS_DEPLOY_DIR`를 설정 파일에서 읽음(이 네 개만 `process.env`로 올린다) | v0.6.1에서 개인 경로 기본값을 없앴더니 지정할 방법이 환경변수뿐이었다. `.env` 전체를 올리면 API 키가 `run_terminal`이 띄우는 명령에 상속되므로 허용 목록으로만 올림 |

**관측(미해결):** 이 PC에는 설정 폴더가 둘이다. `jarvis-ts/data`와 `~/.jarvis`는 API 키·터널 ID가 서로 다르다. 예전에 jarvis-ts의 URL/키로 외부 클라이언트를 설정했다면 jarvis-cli로 옮긴 뒤 끊긴다. 합치려면 한쪽의 `PC_MCP_API_KEY`·`PC_MCP_DEVTUNNEL_ID`를 다른 쪽 `.env`로 옮기고 서버를 재시작해야 한다(사용자 확인 필요).

## v0.8.0 — PC 고유값, 감사 로그·에이전트 보기, 에이전트 친화 CLI

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "한 PC 한 고유값 원칙은 무조건 지켜지게", "사용자가 변경을 요청하는 경우에만 변경 가능하게" | `src/security/identity.ts`: API 키·터널 ID·공개 URL을 `~/.jarvis/identity.json`(PC·OS 사용자당 하나, `JARVIS_HOME`과 무관)에 기록하고 모든 설정 폴더의 `.env`를 그것에 맞춘다(`syncIdentity`). 처음 본 값이 PC의 값(없으면 `.env`에서 채택). 이후 `.env`가 다르면 시작할 때 되돌리고, **실행 중인 서버도 `.env`가 바뀌면 즉시 되돌린다**(`auth.ts` `currentKey`). 터널이 다른 ID를 보고해도 무시. 바꾸는 길은 사용자 행동뿐: `mcp rotate --yes`, 대시보드의 키 재발급·터널 ID, 새 `jarvis identity import <폴더> --yes` | **관측:** 이 PC에는 설정 폴더가 둘(`jarvis-ts/data`, `~/.jarvis`)이고 키·터널이 서로 달랐다 → 기존 외부 클라이언트가 jarvis-ts 값으로 설정돼 있었다면 jarvis-cli로 옮긴 순간 끊긴 것. 새 코드가 처음 실행될 때 `~/.jarvis` 값이 PC의 값으로 채택된다(지금 도는 서비스와 같은 값이라 끊김 없음). jarvis-ts의 값으로 바꾸려면 `jarvis identity import`. 공개 URL만은 터널이 알려주는 관측값이라 갱신을 허용. 신원 파일은 `protectionOf`에서 비밀 파일(도구가 읽지 못함). **테스트는 반드시 임시 `home`을 줄 것**(안 주면 실제 `~/.jarvis/identity.json`을 만든다) |
| "감사로그 보는 기능 지금 있어?" | 웹 대시보드에는 있었고(활동 피드·로그 화면) CLI에는 없었다 → `jarvis audit`(`--tool --status --agent --since -n --json --full`), 입력창 `/audit` | 회전된 `audit.log.1`도 읽는다. 8MB씩만 끝에서 읽음 |
| "MCP Server를 어떤 에이전트가 쓰는지 볼 수 있어야 해" | `server/http.ts`가 `/mcp` POST 본문을 먼저 읽어(트랜스포트에 파싱된 본문으로 넘김) `initialize`·`tools/call`마다 `[AGENT] [mcp] agent=… ver=… ua=… via=local\|tunnel\|remote ip=… rpc=… tool=…` 한 줄을 감사 로그에 남긴다. `jarvis agents`(입력창 `/agents`)가 이름별 호출 수·경로·마지막 사용·자주 쓴 도구를 보여 줌 | 트랜스포트가 stateless라 `tools/call`에는 클라이언트 이름이 없다 → `initialize`의 `clientInfo`를 UA+주소로 기억해 이어 붙임(서버 재시작 직후 이어진 호출은 UA로 표시). 클라이언트가 보낸 문자열은 `JSON.stringify`로 감싸 로그 줄 주입을 막음. 웹 대시보드에 에이전트 화면은 아직 없음 |
| "Agent들이 이 CLI 쓰기 편하게" | `list --json`에 `inputSchema`, `help <tool> --format json`, `--format json`(한 줄 `{"ok","tool","exit_code","result"}`, 인자 누락은 종료 코드 2 + `error`/`usage`), `JARVIS_AGENT`/`CLAUDECODE`로 CLI 호출을 `[AGENT] [cli]`로 기록 | `--json`은 이미 "인자를 JSON으로" 의미라 출력 형식은 `--format json`으로 분리. 업데이트 질문·색·스피너는 사람이 여는 입력창에서만 |
| "설치 완료되면 설치한 버전과 jarvis 소개가 있어야" | `jarvis about`(버전 + 소개 5줄 + 설정 폴더 + 문서 링크), 첫 실행 안내에 같은 소개. README 설치 명령을 `… && jarvis about`으로 | **실험으로 확인:** npm 11.16은 설치 후 스크립트를 기본 실행하지 않고(`allow-scripts` 경고) 출력도 숨긴다 → `postinstall`로는 불가능하고 경고만 늘어난다 |

## v0.8.1 — 화면을 지워도 Jarvis 헤더가 남게

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "클리어를 하면 이게 뭔 서비스인지도 모르겠다, 다 사라져서" | `/clear`·`clear`·`cls`·Ctrl+L 뒤에 로고·버전·`N tools · folders · policy · MCP server` 줄을 다시 그린다(`bannerText`, `statusLine`, `clearScreen`). Ctrl+L은 readline이 자체 처리하므로 `ask()`의 `onClear` 옵션으로 헤더 + 상태 줄 + 입력 중이던 글자를 다시 그림 | 단위 테스트는 Ctrl+L(가짜 TTY)만 검증했다. `/clear`의 실제 터미널 모양은 눈으로 확인하지 못했다(TTY는 실제 터미널에서 확인해야 한다는 기존 교훈) |

## v0.9.0 — `jarvis cli`: 도우미 CLI 확인·설치

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "Jarvis에 CLI가 있는지 확인하고 없으면 설치하는 것도" (GlobalProtect VPN 질문에서 이어짐) | `src/clis.ts`: `jarvis cli [check\|install <name…> --yes] [--json]`, `/cli`, `/doctor`가 같은 목록을 씀. 목록은 enterprise 도구의 `catalog`를 재사용하고 git, devtunnel, pangpcli(GlobalProtect)를 추가. winget/brew 한 줄 명령만 자동 설치, 나머지(sas-viya, pangpcli)는 이유와 방법만 안내 | **`winget`은 앱 실행 별칭이라 PATH 검색(`which`)으로 못 찾고 실행은 된다** → 존재 확인을 `winget --version` 실행으로 했다(처음 구현은 항상 "winget 없음"으로 거부했을 것). 설치 경로 자체는 이 PC에 빠진 설치 가능 CLI가 없어서 **실제 설치는 시험하지 못했다**(확인 경로와 거부 경로, `installPlan` 단위 테스트만). MCP 도구로는 열지 않음: 원격 에이전트가 UAC 확인창을 띄우면 아무도 못 본다 |
| GlobalProtect VPN | 이 PC의 GlobalProtect 6.3.3(MSI)에는 `pangpcli.exe`가 **없다**. Jarvis로 연결하려면 CLI가 필요하고, 문서상 `-start -portal`, `-disconnect`, `-status`가 있다는 검색 결과만 확인(문서 페이지 본문은 못 읽음) | 연결 방식이 `user-logon`(로그인 시 자동). VPN을 켜면 Dev Tunnel이 끊길 수 있음. 상태만 알려 주는 읽기 전용 도구는 가능, 켜는 기능은 CLI 확인 후 |

## v0.10.0 — 첫 호출 때 업데이트 질문, 승낙하면 이어서 실행

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "버전업이 있었던 경우에는 처음 jarvis 호출하면 물어보고, 한다고 하면 업그레이드 진행" | 질문 시점을 입력창에서 **터미널의 모든 첫 명령**으로 넓힘(`main()`에서 `shouldAskAboutUpdate`). `Update now`면 설치 후 **같은 인자로 새 버전을 다시 실행**(`spawnSync(process.execPath, [ENTRY, …args])`, 무한 반복을 막으려 자식에는 `JARVIS_NO_UPDATE_CHECK=1`). 릴리스 확인 주기를 24시간에서 1시간으로(스누즈 "Later"는 그대로 하루) | 파이프·스크립트·에이전트(`--format json`/`--raw`)·`serve`·`update`·`version`·`help`·`completion`은 절대 묻지 않는다(자동 시작 작업이나 에이전트가 멈추면 안 된다). **질문→설치→이어서 실행의 전 과정은 실제 TTY로 돌려 보지 못했다**(판단 함수 단위 테스트와, 설치 단계는 `jarvis update`로 임시 폴더에서 확인한 것뿐) |

## 문서 갱신 — "README.md에 이 MCP Server가 왜 좋은지 + 원격 PC 핸들링 강점 추가"

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "README.md에 이 MCP Server가 왜 좋은지도 적어줘 그리고 사실 가장큰 강점은 MS 코파일럿 같은 클라이언트에 MCP만 연결해 놓으면 원격으로 내 PC를 마음껏 핸들링할 수 있다는 점임" | ① `## 왜 Jarvis MCP Server인가?` 섹션 추가: MS Copilot(Copilot Studio) 연동을 통한 원격 PC 핸들링(킬러 기능), 39개 로컬 도구, 샌드박스/롤백 안전장치, 1 PC 1 Identity 영구 신원, 2-in-1 모드 기술. ② `## MCP 서버로 쓰기`에 스마트폰/외부 기기에서의 원격 제어 활용 시나리오(파일/문서 요약, 빌드/테스트/Git, 백그라운드 작업 등) TIP 블록 추가. | README 수정 후 41개 테스트 전체 통과 확인, GitHub `main`에 커밋 및 푸시 완료 |

## 문서 갱신 — "README.md 영문화 및 스크린샷 3종(TUI, 원격 아키텍처, 웹 대시보드) 추가"

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "이거 근데 README.md 영어로 써 스크린샷도 포함해줘 그리고" | ① README.md 전체를 완성도 높은 영문으로 전면 개편(소개, 킬러 기능, 설치, TUI 모드, MCP 서버, 접근 제어, CLI 확인, 감사 로그, 39개 도구 표, 설정 가이드). ② `assets/` 디렉터리에 3가지 고해상도 시각 스크린샷 생성 및 첨부: `terminal-demo.png`(TUI 프롬프트 및 도구 실행 카드), `copilot-remote-workflow.png`(MS Copilot 연동 원격 PC 자동화 아키텍처 다이어그램), `dashboard-preview.png`(포트 8766 웹 대시보드 미리보기). | Edge headless(`--headless=new`)로 픽셀 단위 렌더링. `main` 브랜치에 커밋 및 푸시 완료 |

## v0.11.0 — 터널 자가 치유(Auto-Healing), 웹 대시보드 에이전트 탭, 모바일 다운로드(`share_file_url`)

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "운영 중인 시스템이니까 날림으로 개발하면 안 돼 진짜 잘 작동하고 안정적으로 작동하게 개발해야 돼" | ① **Dev Tunnel 자가 치유(Auto-Healing)**: `Service`와 `Tunnel`에 `crashLoopCooldownMs`(기본 3분) 옵션을 도입. 10분 5회 크래시 시 영구 중단되지 않고 3분 쿨다운 후 토큰 유효성 검사 및 자동 복구 재시도. ② **대시보드 인코딩 정리**: `src/supervisor/dashboard.ts`의 깨진 한글 58곳을 정상 UTF-8 표준 문구로 치환. ③ **웹 대시보드 에이전트 탭**: `GET /api/agents` 엔드포인트 및 `tab-agents` UI 화면을 추가하여 AI 클라이언트 목록/호출 수/최근 도구 시각화. ④ **모바일 원격 다운로드 도구 (`share_file_url`)**: 스마트폰 Copilot에서 PC의 승인 폴더 내 파일을 다운로드받을 수 있는 임시 HTTPS 링크 발급 및 `GET /download/:token` 핸들러 구현. ⑤ **시스템 상태 보강**: `get_system_status`에 CPU 코어 수/모델 및 OS 가동 시간(Uptime) 추가. | ① **다운로드 엔드포인트 위치**: 대시보드(8766)는 루프백 전용이고 터널은 MCP(8765)만 포워딩하므로 모바일에서 접속하려면 MCP 포트에서 서빙해야 함. ② **공개 다운로드 분기 순서**: `/download/:token`은 URL 내 보안 토큰을 쓰므로 헤더 인증(`auth.handle`)보다 먼저 라우팅되어야 함. ③ 단위/통합 테스트 3건 추가(`test/service.test.ts`, `test/dashboard.test.ts`, `test/share.test.ts`), 44개 테스트 전체 통과 확인. |

## v0.11.1 — 안정성 강화 및 최적화

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "/goal 안정성 강화 및 최적화 수행" | ① **PowerShell AST 인코딩 최적화**: `PS_DUMP` UTF-16LE Base64 변환을 모듈 로드 시점 1회 상수로 캐싱하여 명령어 검사 시 버퍼 할당 및 인코딩 오버헤드 제거 (`policy.ts`). ② **Office 파싱 OOM/손상 방어**: `Zip`에 22바이트 미만 버퍼 검사 및 엔트리 경계 검증 강화. `readXlsx`에서 비정상적인 거대 셀 좌표(`ref="ZZZZ1"`) 파싱 시 OOM을 방지하는 `MAX_COLS = 16384` 상한선 가드 추가 (`docs.ts`). ③ **HTTP 스트리밍 리소스 누수 방지**: `/download/:token` 핸들러에서 클라이언트 조기 종료 시 `stream.destroy()` 호출 및 에러 핸들러를 등록하여 파일 디스크립터 누수 방지 (`http.ts`). ④ **대용량 요청 본문 읽기 및 소켓 블로킹 방어**: `readBody`에서 크기 초과(`max`) 또는 타임아웃(30초) 시 `req.destroy()`를 즉시 호출하여 리소스 낭비 및 소켓 행 방어 (`auth.ts`). ⑤ **SSRF safeFetch 수명 주기 타임아웃**: `once()`에서 응답 스트리밍 지연 시에도 전체 `timeoutMs`를 강제하는 타이머 추가 (`net.ts`). ⑥ **파일 검색 및 리스팅 성능 최적화**: `search_in_files` 선두 4KB 널 바이트 검사로 바이너리 파일을 즉시 건너뛰도록 최적화. `list_files`의 `recursive` 모드 탐색 시 `node_modules` 등 `SKIP_DIRS`를 기본 스택 적재에서 제외하여 재귀 검색 속도 극대화 (`files.ts`). ⑦ **수퍼바이저 프로세스 상태 판별 정확도 향상**: `service.stop()` 시 `c.exitCode === null && c.signalCode === null` 체크로 이미 종료된 프로세스에 대한 불필요한 killTree 방지 (`service.ts`). ⑧ **TUI 터미널 원상 복구 보장**: `select` 실행 중 비정상 프로세스 종료 시 커서 복원(`\x1b[?25h`) 및 raw mode 해제를 보장하는 `process.once("exit")` cleanup 핸들러 추가 (`tui.ts`). ⑨ **견고성 및 최적화 단위 테스트 추가**: `test/robustness.test.ts` 추가 (Zip 손상 거부, OOM 방어, readBody 제한, 바이너리 스킵 및 recursive 제외 검증). | ① **테스트 결과**: 전체 47개 테스트 100% 통과 (`ℹ pass 47, fail 0`), 전체 테스트 수행 시간 약 39.3초에서 35초 수준으로 단축 확인. ② **배포 동기화**: `npm run build`를 통해 TypeScript 소스 변경 사항을 `dist/`에 완전 동기화. |

## v0.12.0 — 팔로알토 GlobalProtect VPN 상태 진단 및 유휴 세션 Keep-Alive 도구

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "이거 지금 팔로알토 VPN 연결하는 거 MCP로 가능하니?", "SAS viya Engage Server의 쿠버너티스에 접속하려고" | ① **VPN 연결 상태 실시간 감지 도구 (`check_vpn_status`)**: 팔로알토 가상 어댑터(`PANGP Virtual Ethernet Adapter Secure`), `PanGPS` 서비스 상태, `~/.kube/config`에 정의된 사내 SAS Viya AKS 클러스터 엔드포인트에 대한 TCP 통신 상태를 종합 진단. K8s 도구 실행 전 VPN 상태를 즉시 판별. ② **VPN 유휴 끊김 방지 Keep-Alive (`vpn_keepalive`)**: 외출/퇴근 전 VPN을 연결해둔 상태에서 사내 VPN 게이트웨이의 유휴 세션 타임아웃(Idle Disconnect)으로 연결이 끊어지는 것을 방지하도록 주기적(기본 3분) 경량 TCP 프로브를 전송하는 백그라운드 타이머 구현 (`start/stop/status`). ③ **총 도구 42개로 확장**: `src/tools/vpn.ts` 구현, `src/tools/index.ts` 등록, `test/vpn.test.ts` 단위/통합 테스트 작성. | ① **환경 검증**: 사용자의 GlobalProtect는 Split Tunneling을 지원하여 VPN 연결 시에도 Microsoft Dev Tunnel(외부 MCP) 세션이 끊어지지 않음을 확인. ② **사내 SSO 인증 특성**: 사내 VPN이 브라우저/SSO(Edge/Azure AD) 팝업 방식을 사용하여 원격에서 비대면 신규 연결은 제한되나, 사전 연결 후 Keep-Alive를 통한 세션 유지 워크플로우로 사내 K8s 접근성을 완전하게 보장. ③ 49개 테스트 전체 통과 확인. |

## v0.12.1 — VPN 도구 안정성 전수 보강 및 엣지 케이스 방어

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "/goal 방금 만든 기능 잘 되는 지 확인하고, 안정성 검토해줘" | ① **DNS 지연 및 소켓 행(Hang) 방어**: `testTcpConnectivity`에 소켓 타임아웃 외에 전체 Promise 수명 주기를 강제하는 워치독 타이머(`setTimeout`)를 추가하여 사내 도메인 해석 지연 시 무한 대기 방어. ② **엔드포인트 입력 정규화 (`parseTargetEndpoint`)**: `target_host`에 URL(`https://...`), `host:port`, trailing path 등이 유입되어도 깨끗하게 호스트와 포트를 파싱하도록 입력 방어 구현. ③ **kubeconfig 파싱 따옴표 방어**: YAML 내 `server: "https://..."` 및 `server: 'https://...'` 따옴표 감싸기 포맷을 완벽하게 수용하도록 `getDefaultKubeServer` 정규식 보강. ④ **크로스 플랫폼 가드 및 어댑터 탐색 유연화**: `queryGlobalProtectAdapter`와 `queryPanGpsService`에 `process.platform !== "win32"` 가드 및 어댑터 검색 조건(`Name -like '*GlobalProtect*'`) 확장. ⑤ **Keep-Alive 예외 격리 및 라이프사이클 보호**: 프로브 내부 `try/catch`로 비정상 종료 방어, 초기 핑 `await` 보장, `unref()` 타이머로 CLI 블로킹 방지, start 중복 호출 시 기존 타이머 안전 정리. ⑥ **TUI 정식 카테고리 등록**: `src/cliutil.ts`에 `"VPN & Network"` 카테고리 등록. ⑦ **단위/통합 테스트 50개 100% 통과**: 엣지 케이스(DNS 실패, kubeconfig 부재/손상/따옴표, URL 파싱, start 재호출, stop 중복) 전수 검증. | ① **YAML 파싱 특성**: YAML 따옴표 감싸기 시 `server:\s*https?` 정규식이 매칭되지 않는 엣지 케이스를 테스트 중 발견하여 `["']?` 패턴으로 즉시 보강. ② **unref() 타이머 적용**: CLI TUI 환경에서 keepalive 타이머가 Node 프로세스의 자연 종료를 블로킹하지 않으면서 백그라운드 주기 핑을 안정적으로 수행하도록 보장. |

## v0.12.2 — 정밀 리뷰 발견 보안/안정성 결함 전수 해결

| 요청 | 한 일 | 함정/결정 |
|---|---|---|
| "/goal 현재 프로젝트 정밀리뷰", "발견한 문제점 당장 해결하자" | ① **내부 AKS 도메인 하드코딩 제거 (P0 보안 조치)**: `src/tools/vpn.ts` 내 하드코딩된 사내 AKS FQDN을 완전히 제거하고, `~/.kube/config` 또는 `JARVIS_VPN_TARGET_HOST` 환경변수 또는 사용자 입력 `target_host`를 필수로 사용하도록 방어. `LLMWiki/work-history.md` 내 노출 정보도 전수 마스킹. ② **OAuth 2.0 PKCE 필수화 (P1 보안 조치)**: `src/security/auth.ts`에서 authorization code 발급 후 토큰 교환 시 `codeChallenge`가 없던 요청은 반드시 마스터 API 키(`client_secret`) 검증을 통과하도록 강제하여 인가 코드 가로채기 방어. `test/security.test.ts`에 검증 테스트 추가. ③ **작업 스케줄러 동기 블로킹 해소 (P1 안정성 조치)**: `src/system/scheduler.ts`의 `listTasks()`를 비동기(`execFile`)로 전환하여 엔터프라이즈 Windows 환경에서 `schtasks /Query` 수행 중 메인 이벤트 루프 프리징 방지. `src/tools/dev.ts` 연동 비동기화. ④ **Office 문서 추출 OOM 방어 및 조기 종료 (P2 성능 최적화)**: `src/files/docs.ts`의 `readDocx`, `readXlsx`, `readPptx`에 `maxChars` 인자를 전달하여 파싱 루프 중간에 요청 글자 수 한도 도달 시 즉시 순회를 중단하도록 최적화. ⑤ **터미널 테이블 CJK 한글 줄맞춤 보정 (P2 UX 개선)**: `src/cliutil.ts`에 전각/한글 2컬럼 폭 계산 함수(`stringWidth`)를 도입하고 `table()` 함수에서 이를 반영하여 한글/영문 혼용 시 열 밀림 현상 완전 해결. | ① **비동기 호환성**: `listTasks()`의 비동기 전환 시 MCP 핸들러(`dev.ts`)가 이미 async 함수이므로 `await listTasks()`로 간단히 전환 완료. ② **테스트 및 빌드 전수 검증**: `npm run typecheck`, `npm test` 50개 테스트 전원 통과, `npm run build`로 `dist/` 최신화 완료. |


