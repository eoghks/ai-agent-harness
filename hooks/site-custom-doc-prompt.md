# 사이트 커스텀 문서 분석 프롬프트

다음은 "{{siteName}}" 사이트 커스텀 커밋 정보입니다. 분석 후 JSON만 반환하세요 (마크다운 코드블록 없이).

## 입력 컨텍스트

커밋: {{commitMsg}}
본문: {{commitBody}}
변경파일: {{changedFiles}}

### 기존 문서 목록
{{existingDocList}}

### 코드 변경 내용
{{diffText}}

---

## 스코프 처리 지침

{{scopeInstruction}}

---

## 기존 문서 연결 판단

기존 문서 목록을 보고 이번 커밋이 기존 문서의 연속(보완·수정·개선)인지 새 기능인지 판단합니다.
- 연속이면 targetFile에 해당 파일명을 반환합니다.
- 새 기능이면 targetFile을 null로 반환합니다.
- 기존 문서가 없으면 항상 null을 반환합니다.

연속 판단 기준:
- 같은 도메인(스코프)의 수정/보완 커밋
- 커밋 메시지에 "보완", "수정", "개선", "추가" 등이 포함된 경우
- 변경된 클래스가 기존 문서에 이미 언급된 클래스인 경우

---

## 문서 제목 기준 (docTitle)

targetFile이 null일 때(신규 문서)만 작성합니다. targetFile이 있으면 null로 반환합니다.

좋은 docTitle 기준:
- 기능/도메인 단위의 재사용 가능한 제목
- 특정 값·버전·날짜는 제외 (예: "레벨 4 → 3 변경" → "조회 레벨 관리")
- 이후 관련 커밋이 같은 문서를 찾을 수 있는 이름
- 한글, 15자 이내

---

## 응답 JSON 형식

{
  "scope": "기능 도메인 한글 스코프명 또는 null",
  "needsClarification": false,
  "targetFile": "기존파일.md 또는 null",
  "docTitle": "신규 문서 제목 또는 null",
  "customerRequirement": "{{siteName}}이 요구한 비즈니스 요구사항 1~3문장 (diff에서 추론)",
  "summary": "기술적 기능 요약 1~2문장",
  "classes": [
    {
      "className": "클래스명(패키지 제외)",
      "filePath": "전체 경로",
      "extendsOrImplements": "상속/구현 관계 (없으면 빈 문자열)",
      "customScope": "커스텀된 메서드/영역",
      "description": "무엇을 왜 바꿨는지 2~4문장",
      "changePoints": [
        { "item": "처리 항목", "standard": "표준 방식", "custom": "{{siteName}} 방식" }
      ]
    }
  ]
}

- scope: 스코프 추론이 가능하면 한글 도메인명 (예: "임시겸직", "결재선", "공지사항"). 불가능하면 null
- needsClarification: 스코프 추론이 불가능하면 true
- classes: 변경된 Java/JS 클래스 모두 포함 (클래스 수가 많아도 전부 포함)
- extendsOrImplements: 빈 문자열이면 changePoints도 빈 배열로 반환 (신규 클래스는 표준 비교 불필요)
