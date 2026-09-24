# drive — AI 요구사항→구현→검증→PR 자동화 파이프라인

Cloudflare Workers 위에서 동작하는 개인 프로젝트용 Agentic 개발 파이프라인.
GitHub Issue에 요구사항을 적고 `ai-feature` 라벨을 붙이면, Claude Code가
요구사항 분석 → 설계 → 구현 → Jest/Playwright 검증 → (실패 시 최대 3회 AutoFix)
→ CodeQL 보안 스캔 → PR 생성까지 자동으로 수행한다. PR을 `main`에 병합하면
`deploy.yml`이 Cloudflare Workers에 배포한다.

## 사용법

1. Issue 생성 → 본문에 요구사항 작성 → `ai-feature` 라벨 부착
   (또는 Actions 탭 → `AI Development Pipeline` → `Run workflow`로 수동 실행)
2. 파이프라인이 끝나면 이슈에 PR 링크가 코멘트로 달림
3. PR 리뷰 후 `main`에 병합 → 자동 배포

## 필요한 GitHub Secrets

| Secret | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Code CLI 인증 |
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy` 인증 (Workers 편집 권한) |
| `CLOUDFLARE_ACCOUNT_ID` | 배포 대상 Cloudflare 계정 |

```
gh secret set ANTHROPIC_API_KEY
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

## 로컬 개발

```
npm install
npm run dev        # wrangler dev, http://localhost:8787
npm run test        # Jest 단위 테스트
npm run test:e2e    # Playwright (wrangler dev를 자동 기동)
npm run deploy       # 수동 배포
```

## 구조

```
.github/workflows/
  ai-dev.yml    이슈/수동 트리거 → 구현 → 검증 → PR
  deploy.yml    main 병합 시 Cloudflare 배포
prompts/        각 단계별 Claude Code 프롬프트
scripts/
  quality-gate.js   coverage-summary.json / e2e 리포트 실측값으로 판정
docs/           요구사항 분석용 참고 문서(메뉴, 비즈니스 규칙, Figma)
src/            Cloudflare Workers 소스
tests/ e2e/     Jest 단위 테스트 / Playwright E2E
```

## 무료 한도 참고

Public 저장소는 GitHub Actions 무료 한도가 무제한이라 반복 실행 걱정이 없다.
CodeQL은 재시도 루프 밖에서 1회만 실행해 비용을 통제한다.
