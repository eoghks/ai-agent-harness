---
name: review
description: 현재 변경분(diff)을 code-reviewer 에이전트로 리뷰한다 — 보안·클린코드·버그 관점. 사용법 /review [브랜치나 커밋 범위]
---

# 코드 리뷰

대상: $ARGUMENTS (비어 있으면 워킹 트리 변경분 + 마지막 커밋)

1. code-reviewer 에이전트에 리뷰 범위를 전달해 위임한다
   (run_in_background로 실행하고 즉시 턴을 종료 — 메인 세션은 사용자가 계속 쓸 수 있게 한다).
2. code-reviewer 보고 전문은 위키 보고서로 저장되므로(전역 CLAUDE.md "에이전트 보고서 위키 저장" 참조),
   메인 세션은 한 줄 요약 + 보고서 경로로만 보고한다(`/reports`로 열람).
   단 critical 발견 시에는 해당 항목(파일:라인, 근거, 수정 방향)을 즉시 채팅에 표출한다.
3. critical이 있으면 수정안을 제시하되, 적용은 사용자 확인 후에만 한다.
