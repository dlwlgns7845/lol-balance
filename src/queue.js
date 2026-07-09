// 내전 모집 큐 배정 (순수 로직, 디코/DB 없음).
// 규칙: 메인전용 > 메인+부(유연자) > 부라인, 동급은 선착순. 유연자는 밀리면 부라인으로(연쇄), 갈 곳 없으면 대기.
// 안정매칭(선수-제안 deferred acceptance)으로 구현 → 밀림·연쇄·대기가 규칙대로 수렴.

export const LANES = ['top', 'jungle', 'mid', 'adc', 'sup'];

/**
 * allocateQueue(signups, size)
 * @param signups [{ id, main:lane, sub:lane|null, order:number }]  (order = 신청 순번, 작을수록 먼저)
 * @param size 10 | 20  (라인당 슬롯 = size/5)
 * @returns { lanes: {top:[id..], ...}, waitlist:[id..] }
 */
export function allocateQueue(signups, size = 10) {
  const N = Math.max(1, Math.floor(size / 5));
  const byId = new Map(signups.map((s) => [s.id, s]));
  // 선호 라인 목록: [메인, (부라인)]. sub='all' 이면 메인 밀렸을 때 나머지 전 라인 후보(올라운더).
  const subsOf = (s) => (s.sub === 'all' ? LANES.filter((l) => l !== s.main) : (s.sub && s.sub !== s.main ? [s.sub] : []));
  const prefs = new Map(signups.map((s) => [s.id, [s.main, ...subsOf(s)]]));
  const nextIdx = new Map(signups.map((s) => [s.id, 0]));
  const held = {}; LANES.forEach((l) => { held[l] = []; });
  // 라인 내 우선순위(낮을수록 우선): 메인전용(0) < 메인+부(1) < 부라인(2), 동급이면 선착순(order)
  const classAt = (s, lane) => (s.main === lane ? (s.sub ? 1 : 0) : 2);
  const rank = (id, lane) => classAt(byId.get(id), lane) * 1e9 + byId.get(id).order;

  const free = signups.map((s) => s.id);
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
  const lanes = {}; LANES.forEach((l) => { lanes[l] = held[l].slice().sort((a, b) => byId.get(a).order - byId.get(b).order); });
  return { lanes, waitlist };
}
