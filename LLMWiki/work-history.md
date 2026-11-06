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
