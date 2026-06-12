---
name: review
description: 현재 변경분(diff)을 code-reviewer 에이전트로 리뷰한다 — 보안·클린코드·버그 관점. 사용법 /review [브랜치나 커밋 범위]
---

# 코드 리뷰

대상: $ARGUMENTS (비어 있으면 워킹 트리 변경분 + 마지막 커밋)

1. code-reviewer 에이전트에 리뷰 범위를 전달해 위임한다.
2. 결과를 critical / warning / suggestion 으로 분류해 보고한다.
   각 항목에 파일:라인, 근거, 수정 방향을 포함한다.
3. critical이 있으면 수정안을 제시하되, 적용은 사용자 확인 후에만 한다.
