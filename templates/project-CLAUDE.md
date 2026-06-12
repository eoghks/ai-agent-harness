# 프로젝트: <이름>

> 이 파일은 ~/.claude/templates/project-CLAUDE.md 템플릿이다.
> 새 저장소 루트에 CLAUDE.md로 복사한 뒤 <> 부분을 채운다.
> 기준: "이걸 안 적으면 Claude가 실수하는가?" — 아니라면 적지 않는다.

## 명령
- 빌드: ./gradlew build
- 테스트(전체): ./gradlew test
- 테스트(단일): ./gradlew test --tests "<클래스명>"
- 실행: ./gradlew bootRun

## 구조 (추측하면 틀리는 것만)
- <핵심 모듈/패키지 한 줄 설명>

## 주의 (실제 사고·실수에서 나온 것만 기록)
- 예: <XxxService는 레거시 — 수정 금지, XxxServiceV2 사용>
- 예: <전체 테스트는 20분 소요 — 단일 클래스만 실행할 것>

## 이 프로젝트의 예외 규칙 (전역 CLAUDE.md와 다른 점만)
- 예: <이 프로젝트는 Java 8 — record·switch expression 사용 금지>
