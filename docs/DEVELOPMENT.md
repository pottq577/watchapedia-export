# 개발 가이드

이 문서는 WatchaPedia Ratings Exporter의 내부 구조와 로컬 개발 방법을 정리합니다. 일반 사용자는 README만 확인하면 됩니다.

## 저장소 구조

```text
.
├── src/
│   ├── browser/
│   │   ├── files.js
│   │   ├── metadata.js
│   │   ├── storage.js
│   │   └── watchapedia.js
│   ├── core/
│   │   ├── checkpoint.js
│   │   ├── csv.js
│   │   ├── identity.js
│   │   └── ratings.js
│   ├── config.js
│   ├── main.js
│   ├── ui.js
│   └── workflow.js
├── scripts/
│   └── build.js
├── tests/
├── watchapedia-exporter.user.js
└── package.json
```

`watchapedia-exporter.user.js`는 배포용 생성 파일입니다. 직접 수정하지 말고 `src/`를 수정한 뒤 다시 빌드합니다.

## 모듈 경계

- `src/core/`: 브라우저 전역 객체에 의존하지 않는 파싱·병합·검증 로직
- `src/browser/watchapedia.js`: 로그인 세션 기반 API/HTML 요청과 사용자 식별
- `src/browser/storage.js`: IndexedDB 체크포인트 저장소
- `src/browser/metadata.js`: 상세 HTML 메타데이터 파싱과 보강 작업
- `src/browser/files.js`: CSV 파일 선택/다운로드
- `src/workflow.js`: 최초 백업·업데이트·중단 재개의 상태 흐름
- `src/ui.js`: WP Export UI
- `src/main.js`: 의존성 조립과 진입점

## 빌드

외부 npm 패키지는 사용하지 않습니다. Node.js 20 이상만 있으면 됩니다.

```bash
npm run build
```

`scripts/build.js`가 CommonJS 형태의 `src/` 모듈을 브라우저용 단일 userscript로 묶고 `package.json`의 버전을 userscript 메타데이터에 반영합니다.

## 로컬 테스트

GitHub Actions 같은 CI는 사용하지 않으며 테스트는 개발자가 로컬에서 실행합니다.

```bash
npm test
```

전체 검증:

```bash
npm run check
```

`npm run check`는 다음을 순서대로 수행합니다.

1. userscript 재빌드
2. 생성된 `watchapedia-exporter.user.js` 문법 검사
3. Node 내장 테스트 실행

현재 테스트 대상은 다음과 같습니다.

- CSV 파싱/직렬화
- 평가 API 응답 정규화
- 기존 CSV 증분 병합
- 안전한 사용자 코드 식별 fallback
- 체크포인트 스키마 호환성 검증
- 상세 메타데이터 요청 성공/실패/재시도 대상 판별

브라우저 DOM 구조 자체는 실제 왓챠피디아 페이지에 종속되므로 자동 테스트만으로 완전히 보장하지 않습니다. HTML 구조 변경은 실제 페이지 확인과 Issue 제보를 함께 사용합니다.

## 사용자 식별

사용자 코드는 다음 순서로 확인합니다.

1. `/api/users/me` 응답
2. `window.__INITIAL_DATA__` 안의 명시적인 `userCode`/`user_code`
3. 페이지 inline script에 직렬화된 명시적인 `userCode`/`user_code`

fallback에서는 단 하나의 고유 사용자 코드만 확인되는 경우에만 사용합니다. 페이지에 있는 임의의 `/ko/users/...` 링크를 현재 사용자로 추정하지 않습니다.

## 체크포인트

현재 체크포인트 스키마는 `2`입니다.

체크포인트는 다음 두 종류의 IndexedDB 레코드로 나뉩니다.

- 작업(run): 모드, 단계, 사용자 코드, 평가 목록 진행 상태, 현재까지 수집한 행, 업데이트 병합 통계
- 작품 진행(progress): `content_code`, 장르, 국가, 상세 정보 처리 상태(`complete`/`failed`)

재개 시 스키마 버전과 필수 필드를 검증합니다. 지원하지 않는 이전 스키마는 자동 재개하지 않습니다.

상세 HTML 요청이 실패한 작품은 `failed`로 기록하고 체크포인트를 유지합니다. 다음 재개에서는 `complete` 항목을 건너뛰고 실패하거나 아직 처리하지 않은 작품만 다시 요청합니다.

상세 페이지 요청 자체는 성공했지만 장르/국가 중 일부가 비어 있는 경우에는 `complete`로 처리해 같은 페이지를 무한 재요청하지 않습니다. 최종 CSV 완료 시 전체 누락 건수를 경고로 표시합니다.

## 릴리스 절차

1. `package.json`의 버전 증가
2. `src/` 수정
3. `CHANGELOG.md` 갱신
4. `npm run check`
5. 생성된 `watchapedia-exporter.user.js`가 변경사항에 포함됐는지 확인
6. 커밋 및 push

Tampermonkey 자동 업데이트는 userscript의 `@version`을 기준으로 동작하므로 버전 증가를 누락하면 안 됩니다.
