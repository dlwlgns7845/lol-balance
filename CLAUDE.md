# lol-balance — 작업/배포 규칙 (AI 먼저 읽기)

> 🔐 **시크릿·보안 규칙은 [AGENTS.md](./AGENTS.md) 참고** (Claude·Codex 등 공통). 커밋 전 시크릿 스캔 필수.

LoL 내전 밸런서·통계 웹앱 (Next.js 14 App Router, JS/JSX, Supabase, Vercel).

## 배포 = git push (Vercel 자동배포)
- 원격: `fbwlgkr7845-hash/lol-balance` (main). Vercel이 이 repo에 연결돼 **push하면 자동 빌드·배포**.
- **`vercel` CLI 절대 쓰지 말 것** (`npx vercel --prod` 금지). 계정이 달라서 엉뚱한 데로 나감. 배포는 오직 git push.
- ⚠️ **커밋 author = Vercel 소유자(fbwlgkr7845) 여야 배포됨.** Vercel Hobby(무료)는 private repo에서 **소유자 명의 커밋만** 자동배포. 다른 명의는 "contributing access 없음"으로 차단.
  - 이 repo git 설정 확인/고정: `git config user.email fbwlgkr7845@gmail.com` · `git config user.name fbwlgkr7845`
  - (진짜 공동작업으로 여러 명의가 push해야 하면 → repo public 전환 or Vercel Pro 필요.)

## 🤝 공동작업 — push 전 필수 절차 (파트너와 협업)
파트너도 같은 main에 push하므로, **내 변경을 push하기 전에 항상 원격을 먼저 확인**한다:

1. `git fetch origin` — 파트너 변경 가져오기
2. `git status -sb` — behind/ahead 확인
3. **원격에 새 커밋이 있으면(behind):**
   - `git pull --rebase origin main` 로 먼저 들여오기
   - 들어온 변경 내용 **리뷰** (git log/diff) — 내 작업과 **겹치는 파일 있는지** 확인
   - `npm run build` 다시 돌려 깨진 데 없는지
   - 충돌 나면 해결 후 빌드 재확인
4. **겹침·충돌 없고 빌드 통과할 때만** `git push origin main`

→ 요약: **fetch → 확인 → (필요시)pull·리뷰 → build → 안 겹치면 push.** 바로 push 금지.

## 커밋 전
- `npm run build` 로 에러 사전 확인 (빌드 깨진 채 push하면 Vercel 배포 실패).
- 커밋 메시지 = 컨벤셔널 (`feat:`, `fix:`, `docs:` …). 한국어 OK.
- node_modules / .next / .env*.local 커밋 금지 (이미 .gitignore).

## 시크릿
- `.env.local` 의 키(SUPABASE_SERVICE_ROLE_KEY, RIOT_API_KEY 등)는 **채팅·커밋에 절대 노출 금지**. 새 값은 형이 직접 파일에 입력.
