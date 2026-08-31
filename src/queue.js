// 내전 모집 큐 배정 (순수 로직, 디코/DB 없음).
// 규칙: 순수 선착순 · 무축출. 먼저 신청한 사람이 우선, 한 번 들어오면 '대기'로 안 밀린다.
//  - 신청 순서대로 자리 배정. 라인이 꽉 차면, 그 라인에 앉은 '유연한 사람'(ALL·부라인 보유자)을
//    자기 다른 허용 라인으로 옮겨(재배치) 자리를 만든다 — 게임엔 그대로 남고 라인만 이동(축출 아님).
//  - 옮길 수 없으면(모두 전용라인) 그 신청자가 대기. ALL도 순서대로 취급 → 먼저 신청한 ALL이 나중 고정보다 우선.
//  - 증가경로(Kuhn 매칭)로 구현: 이미 배정된 사람은 절대 매칭에서 빠지지 않음(재배치만).

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
  const ordered = [...signups].sort((a, b) => a.order - b.order); // 선착순 (created_at)
  const allowedOf = (s) => (s.main === 'all'
    ? [...LANES]
    : [s.main, ...subLanesOf(s)].filter((l) => LANES.includes(l)));

  const assign = {}; LANES.forEach((l) => { assign[l] = []; });
  const waitlist = [];

  // 증가경로: pid를 허용 라인에 배정. 라인이 꽉 차면 그 라인의 배정자(occ)를 occ의 다른 허용 라인으로 옮겨 자리 확보(연쇄).
  // 이미 배정된 사람은 매칭에서 빠지지 않음(라인만 이동). visited로 라인 재방문(사이클) 차단.
  function augment(pid, visited) {
    for (const lane of allowedOf(byId.get(pid))) {
      if (visited.has(lane)) continue;
      visited.add(lane);
      if (assign[lane].length < N) { assign[lane].push(pid); return true; }
      for (let k = 0; k < assign[lane].length; k++) {
        const occ = assign[lane][k];
        if (augment(occ, visited)) { // occ을 다른 라인으로 옮겼음 → 이 라인에 자리 생김
          assign[lane].splice(k, 1);
          assign[lane].push(pid);
          return true;
        }
      }
    }
    return false;
  }

  for (const s of ordered) {
    if (!augment(s.id, new Set())) waitlist.push(s.id); // 재배치해도 자리 없음 → 대기
  }
  const lanes = {}; LANES.forEach((l) => { lanes[l] = assign[l].slice().sort((a, b) => byId.get(a).order - byId.get(b).order); });
  return { lanes, waitlist };
}
