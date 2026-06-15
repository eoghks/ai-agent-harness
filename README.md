# eoghks_harness — Claude Code 하네스 설정

사용자(Rathon R&D)의 Claude Code 하네스 설정 모음. 전역 가이드·서브에이전트·슬래시 커맨드·훅을 한 저장소로 묶어 여러 머신 간 동기화한다.

## 구조

| 경로 | 역할 |
|------|------|
| `CLAUDE.md` | 전역 가이드 — 응답 언어, 작업 방식(비판 의무·범위 준수·검증 후 완료), 코딩/Git 규칙, 워크플로 규약 |
| `agents/` | 서브에이전트 정의 4종 |
| `skills/` | 슬래시 커맨드 정의 |
| `commands/` | 단일 커맨드 정의 (`site-doc` — `site/*` 브랜치 커밋 분석 후 사이트 커스텀 문서 생성/갱신) |
| `hooks/` | 동작 훅 |
| `plans/` | 기능 설계 문서 보관 |
| `templates/` | 신규 프로젝트용 템플릿 (`project-CLAUDE.md`) |
| `settings.json` | 권한(allow/deny)·훅 등록·플러그인·언어 구성 |
| `protected-branches.json` | branch-gate 훅이 읽는 보호 브랜치 목록 |

### agents — 서브에이전트
- `analyzer` — 버그·장애의 근본 원인 추적 분석. 재현·코드 경로 추적·원인/수정 방안 보고. 코드는 수정하지 않는다.
- `implementer` — 작업 명세서대로 구현·테스트·빌드를 수행하고 결과를 보고.
- `code-reviewer` — 변경분(diff)을 보안·클린코드·버그 관점으로 리뷰. 고치지 않고 보고만 한다.
- `verifier` — 작업 결과가 요구사항을 실제로 충족하는지 빌드·테스트를 직접 돌려 독립 검증.

### skills — 슬래시 커맨드
- `work` — 기능 개발 풀사이클 오케스트레이션(설계→위임→구현→리뷰→검증→보고). 메인 세션은 설계·보고만, 실작업은 서브에이전트.
- `analyze` — 증상을 analyzer 에이전트로 분석 위임.
- `review` — 현재 변경분을 code-reviewer 에이전트로 리뷰 위임.
- `commit` — 브랜치 확인 후 Conventional Commits 커밋. 보호 브랜치면 작업 브랜치 생성을 먼저 제안.
- `todo` — 개인 위키 `TODO.md`의 할 일 추가·조회·완료 관리.
- `reports` — 백그라운드 에이전트 보고서 열람·읽음 처리·삭제·정리.

### hooks — 훅
- `branch-gate.js` — PreToolUse(Bash/PowerShell). 보호 브랜치 대상 commit/push/merge/rebase 시 확인을 요구한다.
- `site-custom-doc-update.js` — PostToolUse. `site/*` 브랜치 커밋 시 사이트 커스텀 문서를 갱신한다. (`site-custom-doc-prompt.md` 프롬프트 동반)

## 핵심 워크플로

- **오케스트레이션 중심**: 메인 세션은 설계 대화·위임·보고 수신만 담당하고, 구현·리뷰·검증 등 실작업은 서브에이전트에 위임한다.
- **백그라운드 위임**: 에이전트는 `run_in_background`로 실행하고 즉시 턴을 종료해, 에이전트가 도는 동안에도 메인 세션을 사용자에게 돌려준다.
- **보고서 위키 저장**: 에이전트 완료 보고 전문은 채팅에 쏟지 않고 위키(`wiki\에이전트보고\`, 없으면 `.claude\reports\`)에 파일로 보관한다. 채팅에는 한 줄 요약 + 보고서 경로만 표출하고, critical·차단·입력 필요(needs-input)는 즉시 채팅에 띄운다. 열람·정리는 `/reports` 스킬로 한다.
