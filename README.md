# lol-balance

리그 오브 레전드 내전(커스텀 게임) **팀 밸런싱 + 경기 기록 + 통계** 도구.
기존 franklin-worker 툴의 "187 캡" 방식을 대체 — 라인 단위로 공정한 팀을 자동 구성하고, 결과를 기록해 레이팅을 보정한다.

## 설계 결정 (확정)

- **스택**: Next.js + Supabase (예정). 엔진은 순수 ESM 모듈이라 그대로 import.
- **점수표**: 형이 준 표 그대로(`src/table.js`). 손대지 않음 — 넓은 점수 폭이 정확도의 원천이고, 서폿이 폭 좁은 것(저티어 성비 좋음)이 이미 인코딩돼 있음.
- **밸런싱 = 캡 통과 ❌ → 가중 라인갭 최소화 ✅**.
  - `objective = Σ(라인갭 × 포지션가중치) + 총점차 × totalWeight`
  - 포지션 가중치 = 그 포지션의 점수 폭(탑/정글/원딜 ≈ 1.0, 미드 0.88, 서폿 0.66). 폭 큰 라인의 갭이 더 치명적.
  - 기본 `totalWeight=0.3` → **라인 우선**. "총점은 같은데 한 라인 압살"되는 해를 상위로 안 뽑음.
- **정직성**: 스머프/아웃라이어 z-score 감지, 신호등(총점차 🟢≤10 🟡≤20 🔴), 라인별 갭 ⚠️ 표시. 수학으로 못 맞추는 로비는 그렇다고 보여줌.
- **상위 후보 N개**(중복 제거) 제시 — 하나를 강요하지 않음.
- **lock**: "이 사람 무조건 이 포지션/팀" 고정 후 나머지 최적화.

## 데이터 시드 전략 (티어 자동 배정)

닉네임 → 자동 제안 → **운영자 확정**(자동 머지 금지). 현실에서 가능한 최대치:

| 데이터 | 소스 | 범위 |
|---|---|---|
| 전 시즌 **티어** 히스토리 + 챔프풀 + 현 시즌 승률 | op.gg 공식 MCP (`https://mcp-api.op.gg/mcp`, 무료·무키) | ~2013부터 |
| 시즌별 **솔랭 판수** | Riot match-v5 (Personal 키, queue=420 날짜범위 카운트) | 2021.6 이후 + 최근 ~1000매치 |
| 지속 보정 | 내전 경기 결과 | — |

- op.gg MCP는 전시즌 **티어는** 주지만 시즌별 **판수는 null**(웹에도 없음). 판수는 Riot match-v5로만.
- op.gg HTML 스크래핑 ❌ (ToS·Cloudflare·취약). 내부 API도 불안정.

## 구조

```
src/table.js   점수표 + 포지션 가중치 (순수 데이터)
src/engine.js  balance(players, opts) — 순수 로직, IO 없음
demo.js        CLI 데모 (3 시나리오)
test.js        스모크 테스트 (node test.js)
```

## 사용

```js
import { balance } from './src/engine.js';
const res = balance(players, { totalWeight: 0.3, topK: 5, locks: { sup: { A: '민수' } } });
// res.candidates[0] = 최적 배치, res.outliers = 스머프 경고
```

players: `[{ name, tier, positions:[...] }]` (정확히 10명). tier 키는 `src/table.js` 참고.

## 로드맵

1. ✅ 밸런싱 엔진 (라인우선·스머프감지·lock·후보N)
2. ⬜ Next.js + Supabase 스캐폴딩 (players/tiers/matches 스키마 + 엔진 이식)
3. ⬜ op.gg MCP + Riot match-v5 시드 연동 (제안→확정 UI)
4. ⬜ 경기 기록 / 통계 / 레이팅 보정
5. ⬜ (옵션) AI 요약·자연어 질문
