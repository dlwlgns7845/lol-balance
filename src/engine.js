// 밸런싱 엔진 (순수 로직, UI/IO 없음 — Next.js에서 그대로 import).
// 핵심: "187 캡 통과"가 아니라 "가중 라인갭 최소화"로 최적 배치 탐색.

import { POS, TABLE, laneWeights } from './table.js';

export function tierPts(tier, posIdx, table = TABLE) {
  const row = table[tier];
  if (!row) throw new Error(`알 수 없는 티어: ${tier}`);
  return row[posIdx];
}

// 선수 유효점수 = 티어점수 + 보정(adj).
//  부라인(주포지션 아닌 곳)에 배치되면 부라인 티어(secondaryTier)로 계산, 주라인이면 기존 티어.
export function pPts(p, posIdx, table = TABLE) {
  const offRole = p.primary && p.primary.length > 0 && !p.primary.includes(POS[posIdx]);
  const tier = (offRole && p.secondaryTier) ? p.secondaryTier : p.tier;
  return tierPts(tier, posIdx, table) + (p.adj || 0);
}

// 신호등: 총점차 기준
export function light(totalDiff) {
  if (totalDiff <= 10) return 'green';
  if (totalDiff <= 20) return 'yellow';
  return 'red';
}

// 스머프/아웃라이어 감지: 각자 "가능 포지션 중 최고점"의 z-score
export function detectOutliers(players, z = 1.5, table = TABLE) {
  const rep = players.map((p) =>
    Math.max(...p.positions.map((pos) => pPts(p, POS.indexOf(pos), table)))
  );
  const mean = rep.reduce((a, b) => a + b, 0) / rep.length;
  const sd = Math.sqrt(rep.reduce((a, b) => a + (b - mean) ** 2, 0) / rep.length) || 1;
  return players
    .map((p, i) => ({ name: p.name, tier: p.tier, rep: rep[i], z: (rep[i] - mean) / sd }))
    .filter((o) => o.z >= z)
    .sort((a, b) => b.z - a.z);
}

// 부포지션 여부: player.primary(주포지션 목록)에 없으면 부포지션.
// primary 정보가 없으면(구버전 데이터) 페널티 없이 모두 주포지션 취급.
function isOffRole(player, posIdx) {
  if (!player.primary || player.primary.length === 0) return false;
  return !player.primary.includes(POS[posIdx]);
}

// 한 leaf(완성된 배치) → 평가 스냅샷
function evaluate(A, B, totalWeight, shapeWeight, offRoleWeight, table, W) {
  const lanes = [];
  let sumA = 0, sumB = 0, weightedGap = 0, maxGap = 0, offRole = 0;
  const ptsA = [], ptsB = [];
  for (let i = 0; i < 5; i++) {
    const a = pPts(A[i], i, table), b = pPts(B[i], i, table);
    const gap = Math.abs(a - b);
    sumA += a; sumB += b; weightedGap += gap * W[i];
    maxGap = Math.max(maxGap, gap);
    ptsA.push(a); ptsB.push(b);
    const aOff = isOffRole(A[i], i), bOff = isOffRole(B[i], i);
    if (aOff) offRole++;
    if (bOff) offRole++;
    // 부라인 배치 + 부라인티어 있으면 그 티어를 표시(점수와 일치). 아니면 기본 티어.
    const aTier = (aOff && A[i].secondaryTier) ? A[i].secondaryTier : A[i].tier;
    const bTier = (bOff && B[i].secondaryTier) ? B[i].secondaryTier : B[i].tier;
    lanes.push({ pos: POS[i], weight: W[i], gap,
      a: { name: A[i].name, tier: aTier, baseTier: A[i].tier, secApplied: aTier !== A[i].tier, pts: a, off: aOff },
      b: { name: B[i].name, tier: bTier, baseTier: B[i].tier, secApplied: bTier !== B[i].tier, pts: b, off: bOff } });
  }
  const totalDiff = Math.abs(sumA - sumB);
  // 실력 분포 차이: 각 팀 점수를 정렬해 같은 순위끼리 비교(약한선수↔약한선수).
  // 약한 선수가 한 팀에 몰리면 커짐 → 자동으로 양 팀에 갈라줌.
  const sA = [...ptsA].sort((x, y) => x - y), sB = [...ptsB].sort((x, y) => x - y);
  let shapeDiff = 0;
  for (let i = 0; i < 5; i++) shapeDiff += Math.abs(sA[i] - sB[i]);
  // off-role은 약한 nudge: 밸런스 동급이면 주포지션 배치를 선호(필요시 부포지션 허용)
  const score = weightedGap + totalDiff * totalWeight + shapeDiff * shapeWeight
    + offRole * offRoleWeight;
  return { score, sumA, sumB, totalDiff, weightedGap, maxGap, shapeDiff, offRole, lanes,
    light: light(totalDiff) };
}

// 임의 배치(A,B 각 5명, 포지션 순서)를 재채점 — 수동 스왑용.
export function scoreTeams(A, B, opts = {}) {
  const { totalWeight = 0.3, shapeWeight = 0.4, offRoleWeight = 3, table = TABLE } = opts;
  return evaluate(A, B, totalWeight, shapeWeight, offRoleWeight, table, laneWeights(table));
}

// 배치의 "숫자 시그니처" — 라인별 점수쌍이 같으면 같은 후보로 간주(중복 제거)
function signature(lanes) {
  return lanes
    .map((l) => `${l.pos}:${Math.min(l.a.pts, l.b.pts)}-${Math.max(l.a.pts, l.b.pts)}`)
    .join('|');
}

// locks: { top:{A:'이름',B:'이름'}, mid:{A:'이름'} ... } — 부분 고정 허용
function forced(locks, players) {
  const byName = new Map(players.map((p, i) => [p.name, i]));
  const resolve = (name, pos) => {
    if (name == null) return null;
    const idx = byName.get(name);
    if (idx == null) throw new Error(`lock 대상 "${name}"(${pos})이 로스터에 없습니다`);
    return idx;
  };
  return POS.map((pos) => {
    const l = (locks && locks[pos]) || {};
    return { A: resolve(l.A, pos), B: resolve(l.B, pos) };
  });
}

/**
 * balance(players, opts)
 * @param players [{ name, tier, positions:[...] }] (정확히 10명)
 * @param opts { totalWeight=0.3, topK=5, locks=null }
 * @returns { feasible, candidates:[...], outliers:[...] }
 */
export function balance(players, opts = {}) {
  const { totalWeight = 0.3, shapeWeight = 0.4, offRoleWeight = 3, topK = 5, locks = null, table = TABLE } = opts;
  if (players.length !== 10) throw new Error('정확히 10명 필요');
  const W = laneWeights(table);

  const lock = forced(locks, players);
  const eligible = POS.map((_, pi) =>
    players.map((_, idx) => idx).filter((idx) => players[idx].positions.includes(POS[pi]))
  );
  const seen = new Map(); // signature → 최저점 후보 (중복 제거)
  const used = new Array(10).fill(false);
  const A = new Array(5), B = new Array(5);

  // 한 포지션에 들어갈 (a,b) 후보쌍 생성 — lock 우선
  function pairs(pi) {
    const lk = lock[pi];
    const free = eligible[pi].filter((i) => !used[i]);
    const as = lk.A != null ? [lk.A] : free;
    const out = [];
    for (const a of as) {
      if (used[a] || !players[a].positions.includes(POS[pi])) continue;
      const bs = lk.B != null ? [lk.B] : free;
      for (const b of bs) {
        if (b === a || used[b] || !players[b].positions.includes(POS[pi])) continue;
        // 팀 대칭 제거: 고정 없는 첫 포지션은 idx 작은 쪽을 A로
        if (pi === 0 && lk.A == null && lk.B == null && a > b) continue;
        out.push([a, b]);
      }
    }
    return out;
  }

  function recurse(pi) {
    if (pi === 5) {
      const cand = evaluate(A, B, totalWeight, shapeWeight, offRoleWeight, table, W);
      const sig = signature(cand.lanes);
      const cur = seen.get(sig);
      if (!cur || cand.score < cur.score) seen.set(sig, cand);
      return;
    }
    for (const [a, b] of pairs(pi)) {
      used[a] = used[b] = true;
      A[pi] = players[a]; B[pi] = players[b];
      recurse(pi + 1);
      used[a] = used[b] = false;
    }
  }
  recurse(0);

  // 후보 선택: 추천(종합 최적) + 다양성(총점 최타이트·라인 최타이트) + 차순위들.
  // → 리롤 누르면 "총점이 더 딱 맞는 조합" / "라인이 더 균등한 조합"으로 순환.
  const all = [...seen.values()];
  const byScore = [...all].sort((x, y) => x.score - y.score);
  const byTotal = [...all].sort((x, y) => x.totalDiff - y.totalDiff || x.score - y.score);
  const byGap = [...all].sort((x, y) => x.weightedGap - y.weightedGap || x.score - y.score);
  const picked = [];
  const push = (c) => { if (c && !picked.includes(c)) picked.push(c); };
  push(byScore[0]);            // 1순위 = 추천(종합 최적)
  push(byTotal[0]);            // 총점 최타이트
  push(byGap[0]);              // 라인 최타이트
  for (const c of byScore) push(c); // 나머지 차순위(종합 점수 순)
  const candidates = picked.slice(0, topK);
  return { feasible: candidates.length > 0, candidates, outliers: detectOutliers(players, 1.5, table) };
}

// N명을 포지션에 배정 — 포지션당 정확히 PER명 (주포지션·자격 우선, 부족하면 off-role 강제 채움).
function assignRoles(players, PER) {
  const slots = { top: [], jungle: [], mid: [], adc: [], sup: [] };
  const at = new Array(players.length).fill(null);
  const order = players.map((_, i) => i).sort((a, b) => players[a].positions.length - players[b].positions.length);
  for (const i of order) {
    const prim = (players[i].primary && players[i].primary.length) ? players[i].primary : players[i].positions;
    const cand = [prim.filter((p) => slots[p] && slots[p].length < PER),
      players[i].positions.filter((p) => slots[p].length < PER)];
    let pos = null;
    for (const list of cand) { if (list.length) { pos = list.slice().sort((x, y) => slots[x].length - slots[y].length)[0]; break; } }
    if (pos) { slots[pos].push(i); at[i] = pos; }
  }
  for (let i = 0; i < players.length; i++) {
    if (at[i] != null) continue;
    const pos = POS.find((p) => slots[p].length < PER);
    slots[pos].push(i); at[i] = pos;
  }
  return slots;
}

// 20명 → 4팀(각 포지션 1명씩), 4팀 총점 최대한 균등. order=포지션 처리순서(변형=리롤).
function build4Teams(players, slots, table, order) {
  const teams = [new Array(5), new Array(5), new Array(5), new Array(5)];
  const sum = [0, 0, 0, 0];
  const recompute = () => { for (let t = 0; t < 4; t++) { sum[t] = 0; for (let p = 0; p < 5; p++) sum[t] += pPts(teams[t][p], p, table); } };
  order.forEach((pi) => {
    const pts = (i) => pPts(players[i], pi, table);
    const four = slots[POS[pi]].slice().sort((a, b) => pts(b) - pts(a)); // 강→약
    const tOrder = [0, 1, 2, 3].sort((a, b) => sum[a] - sum[b]);         // 약한 팀 먼저 → 강한 선수
    four.forEach((idx, k) => { const t = tOrder[k]; teams[t][pi] = players[idx]; sum[t] += pts(idx); });
  });
  // 로컬 개선: 같은 포지션 선수 팀간 스왑으로 4팀 총점 편차 최소화
  let improved = true;
  while (improved) {
    improved = false;
    let best = Math.max(...sum) - Math.min(...sum), sw = null;
    for (let pi = 0; pi < 5; pi++) {
      for (let t1 = 0; t1 < 4; t1++) {
        for (let t2 = t1 + 1; t2 < 4; t2++) {
          const a1 = pPts(teams[t1][pi], pi, table), a2 = pPts(teams[t2][pi], pi, table);
          if (a1 === a2) continue;
          const ns = sum.slice(); ns[t1] += a2 - a1; ns[t2] += a1 - a2;
          const sp = Math.max(...ns) - Math.min(...ns);
          if (sp < best - 1e-9) { best = sp; sw = { pi, t1, t2 }; }
        }
      }
    }
    if (sw) { const { pi, t1, t2 } = sw; const tmp = teams[t1][pi]; teams[t1][pi] = teams[t2][pi]; teams[t2][pi] = tmp; recompute(); improved = true; }
  }
  return { teams, sum };
}

/**
 * balance20(players, opts) — 20명 → 4팀 균등 배정 → 2게임. 전체 리롤용 여러 배치(arrangements).
 * 각 arrangement = { views:[snapA, snapB], teamSums:[4팀], spread, outliers:[..] }.
 * 4팀 총점을 최대한 같게(예: 160/160/160/160) 맞추고, (최강+최약)/(2위+3위)로 페어링해 두 게임도 균등.
 */
export function balance20(players, opts = {}) {
  const { table = TABLE } = opts;
  if (players.length !== 20) throw new Error('정확히 20명 필요');
  const slots = assignRoles(players, 4);
  const nameMap = new Map(players.map((p) => [p.name, p]));
  const tenOf = (v) => v.lanes.flatMap((l) => [nameMap.get(l.a.name), nameMap.get(l.b.name)]);
  const orders = [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 3, 0, 4, 2]]; // 처리순서 변형 = 리롤
  const seen = new Set(); const arrangements = [];
  for (const order of orders) {
    const { teams, sum } = build4Teams(players, slots, table, order);
    const ti = [0, 1, 2, 3].sort((a, b) => sum[b] - sum[a]);         // 강→약 팀
    const pairs = [[ti[0], ti[3]], [ti[1], ti[2]]];                  // (최강+최약)/(2위+3위) → 게임 간 균등
    const views = pairs.map(([ta, tb]) => {
      const [A, B] = sum[ta] >= sum[tb] ? [teams[ta], teams[tb]] : [teams[tb], teams[ta]];
      return scoreTeams(A, B, opts);
    });
    const sig = views.map((v) => v.lanes.map((l) => [l.a.name, l.b.name].sort().join('-')).sort().join(',')).sort().join('|');
    if (seen.has(sig)) continue; seen.add(sig);
    arrangements.push({
      views,
      teamSums: pairs.flat().map((t) => Math.round(sum[t] * 10) / 10),
      spread: Math.round((Math.max(...sum) - Math.min(...sum)) * 10) / 10,
      outliers: views.map((v) => detectOutliers(tenOf(v), 1.5, table)),
    });
  }
  return { arrangements };
}

// 10명 → 항상 편성. feasible면 balance() 후보, 아니면 off-role 강제 5v5(팀 총점 균형까지).
function forceBalance(ten, opts) {
  const { table = TABLE } = opts;
  const b = balance(ten, opts);
  if (b.feasible) return b;
  // 포지션당 2명 배정(off-role 허용). 라인 매치업은 고정, A/B 배정만 최적화해 총점차 최소.
  const slots = assignRoles(ten, 2);
  const A = new Array(5), B = new Array(5);
  let rsa = 0, rsb = 0;
  POS.forEach((pos, pi) => { // 초기: 약한 팀에 강한 선수 (그리디, 러닝 합계)
    const [x, y] = slots[pos];
    const px = pPts(ten[x], pi, table), py = pPts(ten[y], pi, table);
    const [strong, ps, weak, pw] = px >= py ? [ten[x], px, ten[y], py] : [ten[y], py, ten[x], px];
    if (rsa <= rsb) { A[pi] = strong; B[pi] = weak; rsa += ps; rsb += pw; }
    else { A[pi] = weak; B[pi] = strong; rsa += pw; rsb += ps; }
  });
  // 로컬 개선: 라인별 A↔B 스왑으로 총점차 더 줄이기
  const sums = () => { let sa = 0, sb = 0; for (let i = 0; i < 5; i++) { sa += pPts(A[i], i, table); sb += pPts(B[i], i, table); } return [sa, sb]; };
  let improved = true;
  while (improved) {
    improved = false;
    const [sa, sb] = sums();
    let best = Math.abs(sa - sb);
    for (let i = 0; i < 5; i++) {
      const na = sa - pPts(A[i], i, table) + pPts(B[i], i, table);
      const nb = sb - pPts(B[i], i, table) + pPts(A[i], i, table);
      if (Math.abs(na - nb) < best - 1e-9) { best = Math.abs(na - nb); const t = A[i]; A[i] = B[i]; B[i] = t; improved = true; break; }
    }
  }
  return { feasible: true, candidates: [{ ...scoreTeams(A, B, opts), forced: true }], outliers: detectOutliers(ten, 1.5, table), forced: true };
}

/**
 * balance20Split(players, opts) — 20명 → 고저 분리. 점수순 상위10=게임1(고티어), 하위10=게임2(저티어).
 * 각 게임 내부만 5v5 밸런싱(독립). 게임별 리롤용 candidates 각각 보유.
 * @returns { games:[balanceResult, balanceResult], lobbies:[[..10],[..10]] }
 */
export function balance20Split(players, opts = {}) {
  const { table = TABLE } = opts;
  if (players.length !== 20) throw new Error('정확히 20명 필요');
  const power = (p) => Math.max(...p.positions.map((pos) => pPts(p, POS.indexOf(pos), table)));
  const order = players.map((_, i) => i).sort((a, b) => power(players[b]) - power(players[a]));
  const top = order.slice(0, 10).map((i) => players[i]);
  const bot = order.slice(10).map((i) => players[i]);
  return { games: [forceBalance(top, opts), forceBalance(bot, opts)], lobbies: [top, bot] };
}
