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

## 인증 구조 — Anthropic API 과금 없음

AI 단계는 Anthropic API(종량 과금)가 아니라 **Claude 구독(Pro/Max)의 OAuth 토큰**으로
실행한다. 로컬에서 `claude setup-token`으로 발급한 토큰을 `CLAUDE_CODE_OAUTH_TOKEN`
Secret에 넣으면, CI의 Claude Code CLI가 구독 사용량 안에서 동작한다.

- 비용: 구독료 외 추가 과금 없음. 대신 구독의 사용량 한도(5시간 윈도·주간 한도)를
  CI 실행이 함께 소모하므로, 파이프라인을 몰아서 돌리면 로컬 Claude Code 사용에 영향을 줄 수 있다.
- 토큰은 유효기간이 있어 만료되면 `claude setup-token`으로 재발급 후 Secret을 갱신한다.

## 등록 전 준비 (직접 해야 하는 일)

- workers.dev 서브도메인: **이미 `j2inlab`으로 설정 완료** (`drive` 배포 시 자동으로
  `drive.j2inlab.workers.dev`가 됨)
- `CLOUDFLARE_ACCOUNT_ID` Secret: **등록 완료**

남은 Secret 2개:

| Secret | 발급 방법 |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 로컬 터미널에서 `claude setup-token` 실행 → 브라우저에서 구독 계정으로 승인 → 출력된 토큰 복사 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 대시보드 → My Profile → API Tokens → "Edit Cloudflare Workers" 템플릿으로 발급 |

```
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo hnjyul/drive
gh secret set CLOUDFLARE_API_TOKEN --repo hnjyul/drive
```

> GitHub Actions 워크플로가 실행 중에 자기 저장소의 Secrets를 스스로 등록하는 것은
> 불가능하다 — `GITHUB_TOKEN`의 permission 스키마 자체에 `secrets` 권한이 없어서
> `workflow_dispatch`로 우회해도 API가 403을 반환한다(플랫폼 차원의 제한).

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
