# drive — AI 요구사항→구현→검증→PR 자동화 파이프라인

Cloudflare Workers 위에서 동작하는 개인 프로젝트용 Agentic 개발 파이프라인.
GitHub Issue에 요구사항을 적고 `ai-feature` 라벨을 붙이면, Claude Code가
요구사항 분석 → 설계 → 구현 → Jest/Playwright 검증 → (실패 시 최대 3회 AutoFix)
→ CodeQL 보안 스캔 → PR 생성까지 자동으로 수행한다. PR을 `main`에 병합하면
`deploy.yml`이 Cloudflare Workers에 배포한다.

운영 주소(목표): **https://drive.j2inlab.workers.dev**
(Worker 이름은 `drive`로 고정됨 — `j2inlab`은 Cloudflare 계정의 workers.dev 서브도메인이며,
아래 "등록 전 준비" 1번에서 계정에 직접 설정해야 한다.)

## 사용법

1. Issue 생성 → 본문에 요구사항 작성 → `ai-feature` 라벨 부착
   (또는 Actions 탭 → `AI Development Pipeline` → `Run workflow`로 수동 실행)
2. 파이프라인이 끝나면 이슈에 PR 링크가 코멘트로 달림
3. PR 리뷰 후 `main`에 병합 → 자동 배포

## 등록 전 준비 (직접 해야 하는 일)

1. **workers.dev 서브도메인을 `j2inlab`으로 설정**
   Cloudflare 대시보드 → Workers & Pages → **Your subdomain** 옆 **Change** → `j2inlab` 입력.
   이 값은 Cloudflare 전체 계정을 통틀어 전역 유일해야 하므로, 이미 다른 계정이 선점했다면
   다른 이름으로 바꿔야 한다(그 경우 `wrangler.jsonc`의 `name`은 그대로 두고 실제 주소만 달라짐).
   MCP로 연결된 Cloudflare 도구들에는 이 값을 조회/변경하는 기능이 없어 이 단계는 직접 해야 한다.

2. **GitHub Secrets 3개 등록**

   | Secret | 용도 |
   |---|---|
   | `ANTHROPIC_API_KEY` | Claude Code CLI 인증 (Anthropic Console에서 발급) |
   | `CLOUDFLARE_API_TOKEN` | `wrangler deploy` 인증 — Cloudflare 대시보드 → My Profile → API Tokens → "Edit Cloudflare Workers" 템플릿으로 발급 |
   | `CLOUDFLARE_ACCOUNT_ID` | 배포 대상 Cloudflare 계정 ID |

   ```
   gh secret set ANTHROPIC_API_KEY --repo hnjyul/drive
   gh secret set CLOUDFLARE_API_TOKEN --repo hnjyul/drive
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo hnjyul/drive
   ```

   > GitHub Actions 워크플로가 실행 중에 자기 저장소의 Secrets를 스스로 등록하는 것은
   > 불가능하다 — `GITHUB_TOKEN`의 permission 스키마 자체에 `secrets` 권한이 없어서
   > `workflow_dispatch`로 우회해도 API가 403을 반환한다(플랫폼 차원의 제한, 설정으로
   > 풀 수 있는 문제가 아님). 값만 알려주면 이 세션의 인증된 `gh` CLI로 바로 대신
   > 등록할 수 있으니, 그때 이 대화에 값을 주면 된다.

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
