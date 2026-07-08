# AGENTS.md — lol-balance 작업 지침 (모든 AI 에이전트 필독: Claude · Codex 등)

LoL 내전 밸런서·통계 웹앱 (Next.js 14 App Router, JS/JSX, Supabase, Vercel).

## 🔐 최우선 규칙: 시크릿 절대 커밋·푸시 금지
**커밋/푸시할 때마다 매번, 민감정보가 올라가지 않는지 다시 확인한다.**

### 시크릿에 해당하는 것
- API 키·토큰: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RIOT_API_KEY`, `GITHUB_TOKEN`, OAuth client secret 등
- `.env`, `.env.local`, `.env*.local` 파일 자체
- 비밀번호, DB 커넥션 스트링, 개인키(private key), 비밀 URL

### 커밋 전 필수 체크 (매번)
1. `git status` — 스테이징에 `.env*` 나 키가 든 파일 없나 확인
2. `git diff --cached` — 추가된 줄에 키·토큰 문자열 없나 눈으로 확인
3. 패턴 스캔 (걸리면 **커밋 중단**하고 그 값 빼기):
   ```
   git diff --cached | grep -iE "service_role|api[_-]?key *[:=]|secret *[:=]|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}"
   ```
4. `.gitignore` 에 `.env*.local` 있는지 확인 (현재 있음). 없으면 먼저 추가.

### 키는 코드에 하드코딩 금지
- 전부 `process.env.XXX` 로 읽는다. **실제 값은 `.env.local`(로컬) + Vercel 환경변수(배포)에만** 존재.
- 새 시크릿 값은 **사람이 직접** `.env.local`에 입력. 채팅·커밋·PR 본문에 붙여넣지 않는다.

### 실수로 올라간 경우
1. 즉시 그 키를 **폐기·재발급(rotate)** — 한 번 노출되면 되돌릴 수 없음.
2. git 히스토리에서 제거(`git filter-repo`) 후 강제푸시.
3. 사람에게 바로 알린다.

## 배포 = git push (Vercel 자동배포)
- 원격 `fbwlgkr7845-hash/lol-balance` (main) → push하면 Vercel 자동 빌드.
- **`vercel` CLI 쓰지 말 것** (`npx vercel --prod` 금지).
- **커밋 author = Vercel 소유자 `fbwlgkr7845` 여야 무료 플랜에서 배포됨.**
  `git config user.email fbwlgkr7845@gmail.com` · `git config user.name fbwlgkr7845` 확인.

## 공동작업 — push 전 절차
`git fetch origin` → 원격에 변경 있으면 `git pull --rebase` 후 리뷰(겹치는 파일 확인) →
`npm run build` (에러 사전확인) → 겹침·충돌 없을 때만 `git push`.

## 코딩
- 커밋 메시지 = 컨벤셔널(`feat:`/`fix:`/`docs:`). node_modules·.next·.env 커밋 금지(gitignore).
