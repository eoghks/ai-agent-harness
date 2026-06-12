---
name: commit
description: 브랜치 확인 후 Conventional Commits 컨벤션으로 커밋한다. 보호 브랜치면 작업 브랜치 생성을 먼저 제안한다. 사용법 /commit [메시지 힌트]
---

# 컨벤션 커밋

1. git status와 git diff로 변경분을 파악한다.
2. 현재 브랜치가 보호 브랜치(~/.claude/protected-branches.json)면
   feature/* 또는 fix/* 브랜치 생성을 먼저 제안한다.
3. 변경 내용에서 타입과 스코프를 추론한다: <타입>(스코프): [사이트명] <설명>
   - site/* 브랜치면 [사이트명]을 포함한다 — 스코프가 docs/site-custom 문서 파일명이 된다.
4. 커밋 메시지를 보여주고 커밋한다.
5. 서로 무관한 변경이 섞여 있으면 분리 커밋을 제안한다.
