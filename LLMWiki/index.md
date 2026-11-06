# jarvis-cli LLMWiki 인덱스

Jarvis(jarvis-ts)의 도구 39개를 **터미널 명령**과 **로컬 MCP 서버**로 쓰는 CLI. 공개 저장소 `Hannoah/jarvis-cli` (MIT).

## 이 위키에 대해

**코드를 읽으면 알 수 있는 것은 쓰지 않는다.** 여기 있는 건 코드만 봐서는 놓치기 쉬운 것 — 왜 그렇게 했는지, 어디가 함정인지, 무엇이 아직 안 끝났는지다.

- 사용법 → `README.md` / 릴리스별 요약 → GitHub Releases / 세부 변경 → git log
- **비밀(토큰·API 키)과 개인 정보(이메일·로컬 경로)는 쓰지 않는다.** 이 폴더는 공개 저장소에 올라간다.
- 작업을 끝낼 때마다 `work-history.md`에 한 항목을, 결정이 있었으면 `decision-log.md`에 한 줄을 추가하고 이 인덱스의 "현재 상태"와 "남은 것"을 고친다.

작업 시작 전 이 `index.md`를 먼저 읽고, 건드릴 영역의 페이지로 이동할 것.

## 읽는 순서
1. [project-context](project-context.md) — 무엇이고 jarvis-ts와 어떤 관계인지, 복사해 온 코드 중 우리가 고친 곳
2. [work-history](work-history.md) — 릴리스별로 **요청 → 한 일 → 함정/결정**
3. [decision-log](decision-log.md) — 결정과 정정 (날짜 · 결정 · 이유)
4. [testing-and-pitfalls](testing-and-pitfalls.md) — 검증 방법(실제 터미널 포함)과 겪은 함정
5. [release-runbook](release-runbook.md) — 배포 절차 (커밋 → push → 릴리스 → 설치 검증)

## 현재 상태 (2026-11-06)
- 최신 릴리스 **v0.8.0**(PC 고유값, 감사 로그·에이전트 보기, 에이전트 친화 CLI) ·  기능은 v0.6.0 — 도구 직접 실행 CLI, 인터랙티브 입력창(상태 줄·자동 제안·메뉴 패널·도구 카드·테마), MCP 서버 제어(start -d / stop / restart / status / tunnel), MCP 연결 정보, 승인 폴더·권한·allowlist 관리.
- 테스트 38개 통과(`npm test`). 도구 39개.
- 사용자의 PC에서는 **jarvis-ts가 같은 포트(8765/8766)로 이미 실행 중**이다. 서버 관련 시험은 반드시 임시 설정 폴더와 임시 포트로 한다 → [testing-and-pitfalls](testing-and-pitfalls.md).
- 설치는 **tarball URL**로만 안내한다(`npm install -g github:...`는 npm 11에서 깨짐).

## 남은 것 (열린 항목)
00. **이 PC의 값이 `~/.jarvis` 기준으로 채택됐다.** `jarvis-ts/data`의 키·터널 ID는 다르다. 예전 값으로 되돌리려면 `jarvis identity import <jarvis-ts/data> --yes`(사용자 결정). 웹 대시보드에는 에이전트 화면이 아직 없다.
0. **터널 경유 레이트리밋(v0.6.1)을 실제 터널로 확인하지 못했다.** 헤더가 붙는다는 가정이다. 터널을 켠 상태에서 외부에서 301회 이상 호출해 429가 나는지 볼 것.
1. **Dev Tunnel을 켠 외부 접속 end-to-end 미검증.** 터널 코드는 jarvis-ts 것 그대로이고 `jarvis tunnel`은 가짜 대시보드로만 시험했다.
2. **터널이 스스로 복구하지 못하는 문제(관측됨, 미해결).** 사용자 환경에서 2026-11-05 21:21경 `403 Proxy Token Expired`가 반복되고 감시 프로세스가 "more than 5 restarts in 10 min"으로 포기한 뒤 `error` 상태로 남았다. 지금은 `jarvis tunnel restart`로 수동 복구. 개선 아이디어: 포기 후 몇 분 뒤 재시도, 또는 토큰 만료를 감지해 호스트를 다시 띄우기 (코드는 `src/supervisor/tunnel.ts`).
3. `jarvis install`(로그인 시 자동 시작) 미검증 — 시스템 설정을 바꾸므로 시험을 미뤘다.
4. `jarvis mcp copy`(클립보드) 미검증 — 사용자의 클립보드를 덮어쓸까 봐 실행하지 않았다.
5. 폭이 넓은 일반 터미널(Windows Terminal)에서 로고 그라데이션·박스 모양을 눈으로 확인하지 못했다(시험 하네스가 색을 변환).
6. **원본 `jarvis-ts`의 `supervisor/dashboard.ts`에 깨진 한글 문자열 58곳**(포트 충돌 진단 문구). 복사본에도 그대로 있다. 원본에서 고친 뒤 다시 복사할 것.
7. 배포에 쓰는 GitHub 토큰의 권한이 필요 이상으로 넓다. `repo` 권한만 가진 토큰으로 바꾸는 것을 권한다(바꾸는 위치는 [release-runbook](release-runbook.md)).

## 코드 위치 (코드만 봐서는 안 보이는 것만)
- `src/{core,files,security,system,tools}`, `src/server/{mcp,plugins,http}.ts`, `src/supervisor/`, `src/main.ts` — **jarvis-ts에서 복사한 코드**. 자동 동기화가 없다. 우리가 고친 파일 목록은 [project-context](project-context.md).
- `src/cli.ts`(진입점·프롬프트), `src/serverCmd.ts`(start/serve/stop 등 서버 명령), `src/update.ts`(업데이트 확인·설치 완료 안내·소개), `src/auditView.ts`(`audit`/`agents`), `src/security/identity.ts`(PC 고유값), `src/admin.ts`(서버 제어·접근 관리·MCP 정보·터널), `src/cliutil.ts`(인자 파싱·렌더링·색/테마, 순수 함수), `src/tui.ts`(메뉴·입력·스피너) — 우리가 새로 쓴 코드.
- `dist/` — **커밋 대상**. 소스를 고치면 `npx tsc` 후 함께 커밋(git 설치에는 빌드 도구가 없음).
