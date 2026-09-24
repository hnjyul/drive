ROLE
Enterprise Architect

INPUT
- artifacts/requirements.md
- 기존 src/ 구조

TASK
artifacts/architecture.md 를 작성한다.

OUTPUT SECTIONS
- System Design
- Component Design
- Sequence Flow
- API Design (경로/메서드/요청·응답 스키마)
- Database/Storage Impact (해당 시 Cloudflare KV/D1/R2 등)

RULES
- 기존 wrangler.jsonc, src/index.ts 의 구조를 벗어나지 않는다.
- 새 바인딩(KV/D1/R2)이 필요하면 wrangler.jsonc에 추가할 설정을 명시한다.
