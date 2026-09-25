# drive — AI 요구사항→구현→검증→PR 자동화 파이프라인

Cloudflare Workers 위에서 동작하는 개인 프로젝트용 Agentic 개발 파이프라인.
GitHub Issue에 요구사항을 적고 `ai-feature` 라벨을 붙이면, Claude Code가
요구사항 분석 → 설계 → 구현 → Jest/Playwright 검증 → (실패 시 최대 3회 AutoFix)
→ CodeQL 보안 스캔 → PR 생성 → AI 리뷰 후 자동 병합까지 수행한다.
배포는 **Cloudflare Workers Builds(Git 연동)** 가 main 푸시를 감지해 자동으로
처리한다 — GitHub에 Cloudflare API 키를 저장할 필요가 없다.

운영 주소: **https://drive.j2inlab.workers.dev**

## 사용법

1. Issue 생성 → 본문에 요구사항 작성 → `ai-feature` 라벨 부착
   (또는 Actions 탭 → `AI Development Pipeline` → `Run workflow`로 수동 실행)
2. 이후는 전자동: 구현 → 테스트/게이트 → CodeQL → PR 생성 →
   **AI 리뷰(APPROVE 시 자동 병합)** → 배포
3. 실패하거나 AI 리뷰가 REJECT하면 이슈에 ⚠️ 알림 코멘트가 달리고
   PR은 열린 채로 남아 사람이 확인한다

자동 병합을 끄려면 `ai-dev.yml`의 `review-merge-deploy` job을 삭제하면 된다
(그러면 PR 병합이 다시 수동이 된다).

## 인증 구조 — Anthropic API 과금 없음

AI 단계는 Anthropic API(종량 과금)가 아니라 **Claude 구독(Pro/Max)의 OAuth 토큰**으로
실행한다. 로컬에서 `claude setup-token`으로 발급한 토큰을 `CLAUDE_CODE_OAUTH_TOKEN`
Secret에 넣으면, CI의 Claude Code CLI가 구독 사용량 안에서 동작한다.

- 비용: 구독료 외 추가 과금 없음. 대신 구독의 사용량 한도(5시간 윈도·주간 한도)를
  CI 실행이 함께 소모하므로, 파이프라인을 몰아서 돌리면 로컬 Claude Code 사용에 영향을 줄 수 있다.
- 토큰은 유효기간이 있어 만료되면 `claude setup-token`으로 재발급 후 Secret을 갱신한다.

## 배포 — Cloudflare Git 연동 (API 키 불필요)

배포는 GitHub Actions가 아니라 Cloudflare Workers Builds가 담당한다.
Cloudflare 대시보드에서 저장소를 1회 연결하면(Workers & Pages → 애플리케이션 생성 →
리포지토리 가져오기 → `hnjyul/drive`), 이후 main에 푸시될 때마다 Cloudflare가
자체 인프라에서 `npx wrangler deploy`를 실행한다. 토큰·키를 GitHub에 저장하지 않는다.

- Worker 이름은 반드시 `drive`로 — 주소가 `drive.j2inlab.workers.dev`가 된다
- GITHUB_TOKEN으로 수행된 자동 병합도 GitHub App 웹훅은 정상 수신하므로 배포가 트리거된다
- 빌드 시간은 Cloudflare 무료 한도(월 3,000분)를 사용한다

## Secrets (등록 완료)

| Secret | 상태 |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | ✅ 등록 완료 — 만료 시 `claude setup-token`으로 재발급 후 갱신 |

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
  ai-dev.yml    이슈/수동 트리거 → 구현 → 검증 → PR → AI 리뷰 → 자동 병합
                (배포는 Cloudflare Git 연동이 main 푸시를 감지해 자동 수행)
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
