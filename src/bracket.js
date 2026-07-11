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
