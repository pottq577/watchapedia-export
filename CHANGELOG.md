# 변경 이력

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 참고합니다.

## [0.2.0] - 2026-09-30

### 추가

- IndexedDB 기반 수집 체크포인트 및 중단 작업 재개 기능
- 평가 목록 페이지 진행 상태와 작품별 상세 메타데이터의 단계별 임시 저장
- WP Export 패널의 **중단된 작업 이어서 진행** 동작
- 버그 제보 및 왓챠피디아 HTML 구조 변경 제보용 GitHub Issue Form

### 변경

- 수집 완료 시 임시 체크포인트를 자동 삭제하도록 데이터 처리 방식 보강
- README에 중단/재개 방식과 IndexedDB 임시 저장 항목, 이슈 제보 방법 문서화

## [0.1.1] - 2026-09-30

### 추가

- Tampermonkey의 자동 업데이트 메타데이터 추가

### 수정

- 왓챠피디아 기본 주소 `https://pedia.watcha.com/ko`가 userscript 실행 대상에 포함되도록 URL 매칭 수정
- Tampermonkey의 사용자 스크립트 실행 설정 안내 보강

## [0.1.0] - 2026-09-30

### 추가

- 영화·시리즈 평가 전체 CSV 백업
- 기존 CSV 기반 증분 업데이트
- `content_code` 기준 신규·변경·삭제 반영
- 신규 또는 누락 작품에 한정한 장르·국가 보강
- 요청 제한 및 일시적 서버 오류 재시도
- Tampermonkey용 간단한 실행 UI
