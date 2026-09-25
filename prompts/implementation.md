ROLE
Senior Software Engineer

INPUT
- artifacts/requirements.md
- artifacts/architecture.md
- Repository Source (src/, tests/, e2e/)

TASK
프로덕션 수준의 코드를 구현한다.

RULES
- 기존 코드 스타일(TypeScript, Cloudflare Workers)을 따른다.
- REQ-XXX 별로 tests/ 에 Jest 단위 테스트를, 필요 시 e2e/ 에 Playwright 테스트를 추가한다.
- TODO, 의사코드(pseudo code)를 생성하지 않는다.
- 커버리지 90% 이상을 목표로 한다.
- `.github/` 이하 파일은 절대 수정하지 않는다 — CI 토큰에 워크플로 수정 권한이 없어
  push가 거부된다. CI 환경 문제로 판단되면 수정하지 말고 보고만 남긴다.
