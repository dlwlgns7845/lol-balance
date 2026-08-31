// 내전 모집 큐 배정 (순수 로직, 디코/DB 없음).
// 규칙: 순수 선착순 · 무축출. 먼저 신청한 사람은 절대 안 밀린다.
//  - 고정 라인: 신청 순서대로 주라인 → (차면)부라인 → (다 차면)대기. 이미 앉은 사람은 나중 신청자가 못 밀어냄.
//  - 올라운더(ALL): 고정 배정 후 남은 빈 자리만 채움(빈 라인 우선), 없으면 대기.
// (옛 안정매칭은 나중 온 메인전용이 먼저 온 유연자를 밀어내 대기시키는 문제가 있어 선착순으로 교체.)

export const LANES = ['top', 'jungle', 'mid', 'adc', 'sup'];

// 부/대기 라인 배열(주라인 제외). sub = 'all' | 콤마목록('jungle,mid') | 단일 | null. 하위호환.
export function subLanesOf(s) {
  if (!s.sub) return [];
  if (s.sub === 'all') return LANES.filter((l) => l !== s.main);
  return String(s.sub).split(',').map((x) => x.trim()).filter((l) => l && l !== s.main && LANES.includes(l));
}

/**
 * allocateQueue(signups, size)
 * @param signups [{ id, main:lane, sub:lane|null, order:number }]  (order = 신청 순번, 작을수록 먼저)
 * @param size 10 | 20  (라인당 슬롯 = size/5)
 * @returns { lanes: {top:[id..], ...}, waitlist:[id..] }
 */
export function allocateQueue(signups, size = 10) {
  const N = Math.max(1, Math.floor(size / 5));
  const byId = new Map(signups.map((s) => [s.id, s]));
  const held = {}; LANES.forEach((l) => { held[l] = []; });
  const waitlist = [];
  // 신청 순서대로 (created_at = order). 먼저 온 사람이 자리를 먼저 잡고, 한 번 앉으면 안 밀린다.
  const ordered = [...signups].sort((a, b) => a.order - b.order);
  const fixed = ordered.filter((s) => s.main !== 'all');
  const rovers = ordered.filter((s) => s.main === 'all');

  // Phase 1: 고정 라인 — 주라인 → (차면)부라인(신청 순) → (다 차면)대기. 축출 없음(이미 앉은 사람 유지).
  for (const s of fixed) {
    const prefs = [s.main, ...subLanesOf(s)].filter((l) => LANES.includes(l));
    const lane = prefs.find((l) => held[l].length < N);
    if (lane) held[lane].push(s.id); else waitlist.push(s.id);
  }
  // Phase 2: 올라운더(주라인 ALL) → 고정 배정 후 남은 빈 라인 채움(가장 빈 라인 우선). 없으면 대기.
  for (const s of rovers) {
    const open = LANES.filter((l) => held[l].length < N);
    if (!open.length) { waitlist.push(s.id); continue; }
    open.sort((a, b) => held[a].length - held[b].length || LANES.indexOf(a) - LANES.indexOf(b));
    held[open[0]].push(s.id);
  }
  const lanes = {}; LANES.forEach((l) => { lanes[l] = held[l].slice().sort((a, b) => byId.get(a).order - byId.get(b).order); });
  return { lanes, waitlist };
}
