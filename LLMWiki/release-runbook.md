# 배포 절차 (릴리스 런북)

작업이 끝나면 **확인 없이** 아래를 끝까지 한다(2026-11-06 사용자 지침). 결과를 보고할 때 "검증한 것"과 "검증하지 못한 것"을 구분해서 적는다.

## 1. 빌드와 테스트
```
npx tsc            # dist/는 커밋 대상이다
npm test           # tsx --test test/*.test.ts
```

## 2. 버전과 문서
- `package.json`의 `version`을 올린다. **버전의 유일한 출처**다(`src/core/version.ts`가 읽는다). 기능 추가는 minor, 수정은 patch.
- README의 설치 명령 태그(`refs/tags/vX.Y.Z`)를 같은 버전으로 고친다.
- 이 위키: `work-history.md`에 항목, 필요하면 `decision-log.md`에 한 줄, `index.md`의 "현재 상태"와 "남은 것"을 갱신한다.
- **BOM 주의:** PowerShell 5.1의 `Set-Content -Encoding UTF8`로 `package.json`·README를 고치지 않는다 → [testing-and-pitfalls](testing-and-pitfalls.md).

## 3. 안전 점검 (매번, push 전)
```
git add -A
git ls-files | grep -E '(^|/)(\.env|data/|node_modules/|audit\.log)'      # 아무것도 나오면 안 됨
git grep -nE "gh[p]_|github_pa[t]_|pcmc[p]_[A-Za-z0-9_-]{20,}"             # 토큰·API 키 패턴이 없어야 함 (대괄호는 이 줄이 스스로를 잡지 않게 하려는 것)
```
`.env`·`data/`·`node_modules/`·`*.log`는 `.gitignore`에 들어 있다.

## 4. 커밋·push
- 커밋 작성자는 noreply 주소를 쓴다(저장소 로컬 설정). 메시지 끝에 `Co-Authored-By` 줄.
- `gh`가 없다. 저장소 루트의 `.env`에 `GITHUB_TOKEN`이 있다(gitignored, **값을 출력하지 않는다, remote URL에 넣지 않는다**). 한 번만 쓰는 헤더로 push한다:
  - `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraheader GIT_CONFIG_VALUE_0="Authorization: Basic <base64 of x-access-token:TOKEN>" git push`
- 토큰 권한을 줄이려면 `repo` 권한만 가진 새 토큰으로 `.env`의 `GITHUB_TOKEN` 값을 바꾼다.

## 5. 릴리스
GitHub API `POST /repos/Hannoah/jarvis-cli/releases`에 `tag_name: vX.Y.Z`, `target_commitish: main`, 본문(변경 요약 + 설치 명령). `gh`가 없으므로 `curl`.
릴리스를 지우고 다시 만들어야 하면 릴리스와 태그(`DELETE .../git/refs/tags/vX.Y.Z`)를 같이 지운다(방금 만든 것에만).

## 6. 게시된 것 검증 (임시 폴더)
```
npm install -g --prefix <임시> https://github.com/Hannoah/jarvis-cli/archive/refs/tags/vX.Y.Z.tar.gz
<임시>/jarvis.cmd version          # 새 버전
<임시>/jarvis.cmd list --names     # 39개
printf '/version\n!echo ok\n/exit\n' | <임시>/jarvis.cmd shell    # 파이프 세션
```
설치 환경에서 `JARVIS_HOME`을 임시 폴더로 지정해, 사용자의 실제 설정을 건드리지 않는다.

## 7. 사용자 PC의 전역 `jarvis` 갱신
`npm pack` → `npm install -g <생성된 tgz>` → `jarvis version`. 끝나면 tgz를 지운다. **실행 중인 jarvis-ts(8765/8766)는 건드리지 않는다.**

## 설치 안내에서 쓰지 말 것
- `npm install -g github:Hannoah/jarvis-cli` — npm 11에서 전역 설치가 임시 clone을 가리켜 깨진다.
- `prepare: tsc` 스크립트 — git 설치에서 `tsc`를 못 찾는다.
