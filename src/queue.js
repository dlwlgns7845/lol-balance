// 내전 모집 큐 배정 (순수 로직, 디코/DB 없음).
// 규칙: 메인전용 > 메인+부(유연자) > 부라인, 동급은 선착순. 유연자는 밀리면 부라인으로(연쇄), 갈 곳 없으면 대기.
// 안정매칭(선수-제안 deferred acceptance)으로 구현 → 밀림·연쇄·대기가 규칙대로 수렴.

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
  // 특정 주라인(부라인 ALL 포함)은 안정매칭, 주라인 ALL(올라운더)은 2단계에서 빈 라인 채움.
  const fixed = signups.filter((s) => s.main !== 'all');
  const rovers = signups.filter((s) => s.main === 'all').slice().sort((a, b) => a.order - b.order);
  const prefs = new Map(fixed.map((s) => [s.id, [s.main, ...subLanesOf(s)]]));
  const nextIdx = new Map(fixed.map((s) => [s.id, 0]));
  const held = {}; LANES.forEach((l) => { held[l] = []; });
  // 라인 내 우선순위(낮을수록 우선): 메인전용(0) < 메인+부(1) < 부라인(2), 동급이면 선착순(order)
  const classAt = (s, lane) => (s.main === lane ? (s.sub ? 1 : 0) : 2);
  const rank = (id, lane) => classAt(byId.get(id), lane) * 1e9 + byId.get(id).order;

  // Phase 1: 특정 주라인 신청자 안정매칭 (선착순·밀림·연쇄)
  const free = fixed.map((s) => s.id);
  const waitlist = [];
  let guard = 0;
  while (free.length && guard++ < 100000) {
    const id = free.shift();
    const pref = prefs.get(id);
    const pi = nextIdx.get(id);
    if (pi >= pref.length) { waitlist.push(id); continue; } // 더 갈 라인 없음 → 대기
    const lane = pref[pi];
    nextIdx.set(id, pi + 1);
    held[lane].push(id);
    if (held[lane].length > N) { // 초과 → 가장 후순위 1명 밀어냄(연쇄)
      held[lane].sort((a, b) => rank(a, lane) - rank(b, lane));
      free.push(held[lane].pop());
    }
  }

  // Phase 2: 올라운더(주라인 ALL) → 선착순으로 가장 빈 라인부터 채움 (없으면 대기)
  for (const s of rovers) {
    const open = LANES.filter((l) => held[l].length < N);
    if (!open.length) { waitlist.push(s.id); continue; }
    open.sort((a, b) => held[a].length - held[b].length || LANES.indexOf(a) - LANES.indexOf(b));
    held[open[0]].push(s.id);
  }
  const lanes = {}; LANES.forEach((l) => { lanes[l] = held[l].slice().sort((a, b) => byId.get(a).order - byId.get(b).order); });
  return { lanes, waitlist };
}
