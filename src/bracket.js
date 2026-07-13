// 싱글 엘리미네이션 대진 생성/진출 (순수 로직, DB·UI 없음).

const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return Math.max(2, p); };

// 표준 토너먼트 시드 순서 — 상위 시드가 늦게 만나게. 반환: 슬롯순서의 1-based 시드 배열.
function seedOrder(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    const next = [];
    for (const s of seeds) { next.push(s); next.push(sum - s); }
    seeds = next;
  }
  return seeds;
}

// 이 경기의 승자가 올라갈 다음 경기 위치. 결승이면 null.
export function nextSlot(round, pos, totalRounds) {
  if (round >= totalRounds) return null;
  return { round: round + 1, pos: Math.floor(pos / 2), slot: pos % 2 === 0 ? 'a' : 'b' };
}

export const roundsOf = (nTeams) => Math.log2(nextPow2(Math.max(2, nTeams)));

// teams: [{id, seed?}] (approved). seed 없으면 배열 순서대로 1..n.
// 반환: [{round, pos, team_a, team_b, winner}] — round1 부전승은 자동 진출까지 반영.
export function generateSingleElim(teams) {
  const n = teams.length;
  if (n < 2) return [];
  const size = nextPow2(n);
  const seeded = teams.map((t, i) => ({ id: t.id, seed: t.seed || i + 1 }));
  const bySeed = new Map(seeded.map((t) => [t.seed, t.id]));
  const slots = seedOrder(size).map((seed) => bySeed.get(seed) || null); // null = 부전승
  const totalRounds = Math.log2(size);
  const matches = [];
  for (let i = 0; i < size / 2; i++) {
    matches.push({ round: 1, pos: i, team_a: slots[2 * i], team_b: slots[2 * i + 1], winner: null });
  }
  for (let r = 2; r <= totalRounds; r++) {
    for (let i = 0; i < size / (2 ** r); i++) matches.push({ round: r, pos: i, team_a: null, team_b: null, winner: null });
  }
  const byKey = new Map(matches.map((m) => [`${m.round}:${m.pos}`, m]));
  // round1 부전승 → 자동 승리 + 다음 라운드로 진출
  for (const m of matches.filter((x) => x.round === 1)) {
    const bye = (m.team_a && !m.team_b) ? m.team_a : (!m.team_a && m.team_b) ? m.team_b : null;
    if (!bye) continue;
    m.winner = bye;
    const nx = nextSlot(1, m.pos, totalRounds);
    if (nx) { const nm = byKey.get(`${nx.round}:${nx.pos}`); if (nm) nm[`team_${nx.slot}`] = bye; }
  }
  return matches;
}

// ── 그룹 스테이지 (조별 라운드로빈 → 본선 싱글엘리) ──

// 시드 순서 teams를 groupCount개 조로 스네이크 분배 → 각 조 라운드로빈 매치.
// 반환 매치: { bracket:'G', grp, round:1, pos, team_a, team_b, winner:null }
export function generateGroups(teams, groupCount) {
  const gc = Math.max(1, Math.min(groupCount, teams.length));
  const groups = Array.from({ length: gc }, () => []);
  teams.forEach((t, i) => {
    const band = Math.floor(i / gc);
    const gi = band % 2 === 0 ? i % gc : gc - 1 - (i % gc); // 스네이크(강팀 분산)
    groups[gi].push(t.id);
  });
  const matches = [];
  groups.forEach((g, gi) => {
    let pos = 0;
    for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) {
      matches.push({ bracket: 'G', grp: gi, round: 1, pos: pos++, team_a: g[a], team_b: g[b], winner: null });
    }
  });
  return { groups: groups.map((ids) => ids.slice()), matches };
}

// 조 내 승자승(head-to-head): x가 y를 이겼으면 -1, 졌으면 1, 미정 0
function h2h(matches, gi, xid, yid) {
  const m = matches.find((mm) => mm.bracket === 'G' && mm.grp === gi && mm.winner
    && ((mm.team_a === xid && mm.team_b === yid) || (mm.team_a === yid && mm.team_b === xid)));
  if (!m) return 0;
  return m.winner === xid ? -1 : 1;
}

// 조별 순위표: [[{id, w, l, played}]] — 승수 → 승자승 → 패수 순.
export function groupStandings(matches, groups) {
  return groups.map((g, gi) => {
    const rec = Object.fromEntries(g.map((id) => [id, { id, w: 0, l: 0, played: 0 }]));
    matches.filter((m) => m.bracket === 'G' && m.grp === gi && m.winner).forEach((m) => {
      const loser = m.winner === m.team_a ? m.team_b : m.team_a;
      if (rec[m.winner]) { rec[m.winner].w += 1; rec[m.winner].played += 1; }
      if (rec[loser]) { rec[loser].l += 1; rec[loser].played += 1; }
    });
    return Object.values(rec).sort((x, y) => (y.w - x.w) || h2h(matches, gi, x.id, y.id) || (x.l - y.l));
  });
}

// 조별 상위 advance팀을 본선 시드로. 조1위끼리 → 조2위끼리 순, 크로스 배치.
export function knockoutSeeds(standings, advance) {
  const adv = Math.max(1, advance);
  const seeds = [];
  for (let rank = 0; rank < adv; rank += 1) {
    standings.forEach((st) => { if (st[rank]) seeds.push(st[rank].id); });
  }
  return seeds.map((id, i) => ({ id, seed: i + 1 }));
}

// 모든 조 경기가 끝났는지
export const groupsComplete = (matches) => {
  const g = matches.filter((m) => m.bracket === 'G');
  return g.length > 0 && g.every((m) => m.winner);
};

// ── 더블 엘리미네이션 (승자조 W · 패자조 L · 최종결승 GF) ──
// 단순화: 참가팀 = 2의 거듭제곱(4/8/16/32…). 부전승 없음. 최종결승 단판(브라켓 리셋 없음).

// 팀 수 n(2^k)에서 파생 파라미터
export function deParams(n) {
  const k = Math.log2(n);
  if (!Number.isInteger(k) || n < 4) throw new Error('더블 엘리는 4·8·16·32… (2의 거듭제곱) 팀만 가능해요');
  return { k, lbRounds: 2 * (k - 1) };
}
// WB matches R1 개수로 n 역산
export const deParamsFromMatches = (matches) => deParams(matches.filter((m) => m.bracket === 'W' && m.round === 1).length * 2);

// 승자조 승자 진출
export function wbWinTo(round, pos, k) {
  return round < k
    ? { bracket: 'W', round: round + 1, pos: Math.floor(pos / 2), slot: pos % 2 ? 'b' : 'a' }
    : { bracket: 'GF', round: 1, pos: 0, slot: 'a' }; // 승자조 결승 승자 → 최종결승
}
// 승자조 패자 → 패자조 (R1은 초기 진입, R>=2는 major 라운드에 역순 배치=리매치 지연)
export function wbLoseTo(round, pos, k) {
  if (round === 1) return { bracket: 'L', round: 1, pos: Math.floor(pos / 2), slot: pos % 2 ? 'b' : 'a' };
  const l = 2 * (round - 1);
  const cnt = 2 ** (k - round);
  return { bracket: 'L', round: l, pos: cnt - 1 - pos, slot: 'b' }; // slot a=패자조 생존자, b=WB 강등자
}
// 패자조 승자 진출
export function lbWinTo(l, pos, k, lbRounds) {
  if (l === lbRounds) return { bracket: 'GF', round: 1, pos: 0, slot: 'b' }; // 패자조 결승 승자 → 최종결승
  if (l % 2 === 1) return { bracket: 'L', round: l + 1, pos, slot: 'a' };    // minor→다음 major slot a
  return { bracket: 'L', round: l + 1, pos: Math.floor(pos / 2), slot: pos % 2 ? 'b' : 'a' }; // major→다음 minor
}

// 더블 엘리 대진 생성. teams: [{id, seed?}] (n=2^k). 반환: [{bracket, round, pos, team_a, team_b, winner}]
export function generateDoubleElim(teams) {
  const n = teams.length;
  const { k, lbRounds } = deParams(n);
  const seeded = teams.map((t, i) => ({ id: t.id, seed: t.seed || i + 1 }));
  const bySeed = new Map(seeded.map((t) => [t.seed, t.id]));
  const slots = seedOrder(n).map((seed) => bySeed.get(seed) || null);
  const matches = [];
  // 승자조
  for (let r = 1; r <= k; r += 1) {
    for (let p = 0; p < 2 ** (k - r); p += 1) {
      matches.push({ bracket: 'W', round: r, pos: p, team_a: r === 1 ? slots[2 * p] : null, team_b: r === 1 ? slots[2 * p + 1] : null, winner: null });
    }
  }
  // 패자조 라운드별 매치 수
  const lbCount = { 1: n / 4 };
  for (let r = 2; r <= k; r += 1) { lbCount[2 * (r - 1)] = 2 ** (k - r); if (r < k) lbCount[2 * (r - 1) + 1] = 2 ** (k - r - 1); }
  for (let l = 1; l <= lbRounds; l += 1) {
    for (let p = 0; p < (lbCount[l] || 0); p += 1) matches.push({ bracket: 'L', round: l, pos: p, team_a: null, team_b: null, winner: null });
  }
  // 최종결승
  matches.push({ bracket: 'GF', round: 1, pos: 0, team_a: null, team_b: null, winner: null });
  return matches;
}
