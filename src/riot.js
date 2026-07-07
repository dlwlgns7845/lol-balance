// Riot 공식 API로 솔랭 시즌 평균 티어 시드. 서버 전용.
import { mapTier, fetchProfile, mapTierApexAware, keyStrength, nerfCurrentApex } from './opgg.js';

// ── op.gg season_id ↔ 실제 시즌 날짜창 (NA). 형 스샷으로 확인된 매핑.
// 29=2024S3, 27=2024S2, 25=2024S1, 23=2023S2, 21=2023S1, 19=2022, 17=2021 …
// 2025+ (31~)은 +2/스플릿 외삽. 1년마다 새 id+날짜 추가(유지보수). match-v5 바닥=2021-06-16.
// op.gg가 시즌을 버킷팅하는 granularity 그대로 따라감(검증된 id만 하드코딩).
// 2024까지는 스플릿 3개/년, 2025부터 연1회(랭크 리셋이 연단위로 바뀜 — op.gg가 한 해=한 id로 줌).
// 형 데이터로 확인: 33=2026, 31=2025, 29=2024S3, 27=2024S2, 25=2024S1, 23=2023S2, 21=2023S1, 19=2022, 17=2021.
// ⚠️ 미래 id는 추측하지 말 것 — 새 시즌 뜨면 op.gg에서 확인 후 추가(유지보수). 표에 없으면 그 시즌은 판수검증 skip.
const SEASON_DATE = {
  33: ['2026-01-08', '2027-01-07'], // 2026 (현재, 연단위)
  31: ['2025-01-09', '2026-01-08'], // 2025 ✓ (연단위 — 쪼개면 각 스플릿 150판 미달로 오판)
  29: ['2024-09-25', '2025-01-09'], // 2024 S3 ✓
  27: ['2024-05-15', '2024-09-25'], // 2024 S2 ✓
  25: ['2024-01-10', '2024-05-15'], // 2024 S1 ✓
  23: ['2023-07-17', '2024-01-10'], // 2023 S2 ✓
  21: ['2023-01-10', '2023-07-17'], // 2023 S1 ✓
  19: ['2022-01-07', '2023-01-10'], // 2022 ✓
  17: ['2021-01-08', '2022-01-07'], // 2021 ✓ (바닥에서 클립)
};
const MATCHV5_FLOOR = Math.floor(Date.parse('2021-06-16T00:00:00Z') / 1000);
function seasonWindow(seasonId) {
  const d = SEASON_DATE[seasonId];
  if (!d) return null; // 표 밖(2020↓ 또는 미래 미등록) → 검증 불가
  const end = Math.floor(Date.parse(d[1] + 'T00:00:00Z') / 1000);
  if (end <= MATCHV5_FLOOR) return null; // match-v5 바닥 이전
  return { start: Math.max(Math.floor(Date.parse(d[0] + 'T00:00:00Z') / 1000), MATCHV5_FLOOR), end };
}

const PLATFORM = { NA: 'na1', KR: 'kr', EUW: 'euw1', EUNE: 'eun1', BR: 'br1', JP: 'jp1', OCE: 'oc1', LAN: 'la1', LAS: 'la2', TR: 'tr1', RU: 'ru' };
const REGIONAL = { NA: 'americas', BR: 'americas', LAN: 'americas', LAS: 'americas', OCE: 'americas', KR: 'asia', JP: 'asia', EUW: 'europe', EUNE: 'europe', TR: 'europe', RU: 'europe' };
const ROMAN = { I: 1, II: 2, III: 3, IV: 4 };

async function riotGet(url, key) {
  const r = await fetch(url, { headers: { 'X-Riot-Token': key } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Riot API ${r.status}`);
  return r.json();
}

export function hasRiotKey() {
  return !!process.env.RIOT_API_KEY;
}

export async function fetchRiotProfile(gameName, tagLine, region) {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error('RIOT_API_KEY 없음');
  const reg = (region || 'NA').toUpperCase();
  const regional = REGIONAL[reg] || 'americas';
  const platform = PLATFORM[reg] || 'na1';

  const acc = await riotGet(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, key);
  if (!acc) return { found: false, error: '소환사를 찾을 수 없음 (Riot ID 확인)' };

  const entries = await riotGet(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${acc.puuid}`, key) || [];
  const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  const flex = entries.find((e) => e.queueType === 'RANKED_FLEX_SR');
  const pick = solo || flex;
  if (!pick) {
    return { found: true, gameName: acc.gameName, tag: acc.tagLine, suggestedTier: null, basis: '언랭', games: 0, confidence: 'low', source: 'riot' };
  }
  const div = ROMAN[pick.rank] || 1;
  const suggestedTier = nerfCurrentApex(mapTier(pick.tier, div, pick.leaguePoints)); // 현재 랭크 → 마스터+면 ×0.6
  const games = (pick.wins || 0) + (pick.losses || 0);
  const confidence = games >= 100 ? 'high' : games >= 30 ? 'medium' : 'low';
  return {
    found: true, gameName: acc.gameName, tag: acc.tagLine,
    suggestedTier, basis: solo ? '현재 솔랭' : '현재 자유랭',
    games, confidence, source: 'riot',
    solo: solo ? { tier: solo.tier, division: div, win: solo.wins, lose: solo.losses } : null,
    flex: flex ? { tier: flex.tier, division: ROMAN[flex.rank] || 1, win: flex.wins, lose: flex.losses } : null,
  };
}

// ── 시즌 평균 (B): 솔랭만, 최근 4창 중 100판+ 시즌 티어 평균 ──
const TIER_ORD = { IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 7, CHALLENGER: 7 };
function tierToOrd(tier, division) {
  const b = TIER_ORD[(tier || '').toUpperCase()];
  if (b == null) return null;
  if (b >= 7) return 28;                 // 마스터+ (과거 시즌은 LP 없어 한 단계로)
  return b * 4 + (4 - (division || 1));  // 디비전 1=상위
}
function ordToKey(ord) {
  if (ord >= 27.5) return 'M0';
  const ti = Math.floor(ord / 4);
  const d = Math.max(1, Math.min(4, Math.round(4 - (ord - ti * 4))));
  if (ti >= 6) return 'D' + d;
  if (ti === 5) return 'E' + d;
  if (ti === 4) return 'P' + d;
  if (ti === 3) return 'G' + d;
  if (ti === 2) return d <= 2 ? 'S' + d : 'S3-';
  return 'S3-';
}

async function countSolo(regional, puuid, key, start, end) {
  let cnt = 0, off = 0;
  while (off < 1000) {
    const ids = await riotGet(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${start}&endTime=${end}&start=${off}&count=100`, key);
    if (!ids || !ids.length) break;
    cnt += ids.length; off += ids.length;
    if (ids.length < 100) break;
  }
  return cnt;
}

// ≥100 판정용: 최대 2페이지(200판)까지만 세고 멈춤 (윈도우당 호출 ≤2회)
async function countSoloCapped(regional, puuid, key, start, end) {
  let cnt = 0, off = 0;
  for (let page = 0; page < 2; page++) {
    const ids = await riotGet(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${start}&endTime=${end}&start=${off}&count=100`, key);
    if (!ids || !ids.length) break;
    cnt += ids.length; off += ids.length;
    if (ids.length < 100) break;
  }
  return cnt; // 200이면 "200+" 의미
}

// Riot 보관 경계(가장 오래된 솔랭 매치 sec) + 최근 솔랭 총 판수(활동성 지표). 활성계정일수록 경계가 최근.
async function soloHistory(regional, puuid, key) {
  let off = 0, last = null;
  for (let p = 0; p < 6; p++) { // 최대 600판
    const ids = await riotGet(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=${off}&count=100`, key);
    if (!ids || !ids.length) break;
    last = ids[ids.length - 1]; off += ids.length;
    if (ids.length < 100) break;
  }
  const total = off;
  let oldestTs = null;
  if (last) {
    try {
      const m = await riotGet(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${last}`, key);
      oldestTs = m?.info?.gameCreation ? Math.floor(m.info.gameCreation / 1000) : null;
    } catch {}
  }
  return { oldestTs, total };
}

// ── 하이브리드 (형 룰): ① 현재 솔랭 ≥200판 → 현재 티어. ② <200판이면 과거 시즌을
// 최근부터 Riot 판수검증 → ≥150판인 "가장 가까운(최근)" 시즌의 티어(최고 아님). ③ 다 부족 → op.gg 최고티어(의심). ──
const CUR_MIN = 200, SEASON_MIN = 150, MAX_CHECK = 10; // MAX_CHECK=Riot 검증 시즌 수(레이트리밋 보호)
export async function fetchTierEstimateHybrid(gameName, tagLine, region) {
  const key = process.env.RIOT_API_KEY;
  const reg = (region || 'NA').toUpperCase();
  const regional = REGIONAL[reg] || 'americas';
  const prof = await fetchProfile(gameName, tagLine, region); // op.gg: solo, seasons, peak
  if (!prof.found) return prof;

  const acc = key ? await riotGet(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, key) : null;

  const cur = prof.solo, curGames = cur ? (cur.win || 0) + (cur.lose || 0) : 0;

  // ① 현재 시즌 200판+ → 현재 티어
  if (cur && cur.tier && curGames >= CUR_MIN) {
    const k0 = mapTierApexAware(cur.tier, cur.division, cur.lp);
    const k = nerfCurrentApex(k0); // 현재 시즌 → 마스터+면 ×0.6
    return { found: true, gameName: prof.gameName, tag: prof.tag,
      suggestedTier: k,
      basis: `현재 솔랭 ${cur.tier}${cur.division || ''} ${curGames}판 (≥${CUR_MIN})${k !== k0 ? ` · 내전보정 ×0.6→${k}` : ''}`,
      games: curGames, confidence: 'high', source: 'hybrid' };
  }
  // Riot 키 없으면 과거 판수검증 불가 → op.gg 단독 로직으로
  if (!acc) return fallbackOpgg(prof, curGames);

  // ② 후보 = 현재시즌 최고티어 + 최근 과거시즌 최고티어들. 각 후보의 Riot ≥150 검증 여부 판정.
  //    Riot은 일부 계정 과거 매치를 다 안 줌(보관 경계). 시즌 END가 경계보다 최근이면 카운트 가능, 아니면 끊김=미검증.
  const { oldestTs: retStart } = await soloHistory(regional, acc.puuid, key);
  const seasons = prof.seasons || []; // op.gg가 season_id 내림차순(최신순) 정렬
  const perSeason = [];
  const cand = [];
  if (prof.curHigh && prof.curHigh.tier) {
    cand.push({ tier: prof.curHigh.tier, division: prof.curHigh.division, lp: prof.curHigh.lp, src: '현재시즌', cur: true, verified: curGames >= SEASON_MIN, games: curGames });
  }
  for (let i = 0; i < seasons.length && i < 5; i++) { // 최근 5시즌만
    const s = seasons[i];
    const w = seasonWindow(s.season_id);
    let games = null, verified = false, note = '표밖';
    if (w) {
      if (retStart && w.end > retStart) {            // Riot이 이 시즌 후반 이상 커버 → 카운트
        try { games = await countSoloCapped(regional, acc.puuid, key, w.start, w.end); } catch {}
        verified = games != null && games >= SEASON_MIN;
        note = games != null ? `${games >= 200 ? '200+' : games}판${verified ? ' 검증' : '(부족)'}` : '카운트실패';
      } else { note = 'Riot 기록 끊김(미검증)'; }     // 보관밖(트렁케이션)
    }
    cand.push({ tier: s.tier, division: s.division, lp: s.lp, src: `S${s.season_id}`, verified, games });
    perSeason.push({ tier: s.tier, division: s.division, lp: s.lp, games, qualified: verified, note });
  }

  const label = (c) => `${c.tier}${c.division || ''}${c.lp != null ? ` ${c.lp}LP` : ''}`;
  if (!cand.length) {
    return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: null,
      basis: '랭크 기록 없음 — 직접 선택', games: curGames, confidence: 'low', source: 'hybrid', perSeason };
  }

  // ③ 최고 peak 선택 + 신뢰도 판정 (형 룰)
  cand.forEach((c) => { let k = mapTierApexAware(c.tier, c.division, c.lp); if (c.cur) k = nerfCurrentApex(k); c.key = k; c.strength = keyStrength(c.key); }); // 현재시즌만 ×0.6
  cand.sort((a, b) => b.strength - a.strength);
  const best = cand[0];
  const vMax = Math.max(-1, ...cand.filter((c) => c.verified).map((c) => c.strength));
  const confident = vMax >= best.strength - 110;     // best가 검증됐거나 검증시즌이 1티어 내
  const isMasterPlus = best.strength >= 1000;        // M버킷=1000+
  const lab = label(best);

  if (confident) {
    return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: best.key,
      basis: `현재 ${curGames}판<${CUR_MIN} → ${lab} (Riot ≥${SEASON_MIN}판 검증)`,
      games: curGames, confidence: 'high', source: 'hybrid', perSeason };
  }
  if (isMasterPlus) { // 마스터+는 적은 판수로 못 감 → 트렁케이션 가능성, 티어는 부여하되 확인 요망
    return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: best.key,
      basis: `⚠️ Riot 마지막 기록이 끊겨 ≥${SEASON_MIN}판 검증 불가 → 확인 요망. op.gg 최고 ${lab} (마스터+)`,
      games: curGames, confidence: 'medium', suspect: true, source: 'hybrid', perSeason };
  }
  return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: best.key, // 다이아 이하 + 미검증
    basis: `⚠️ 판수부족 의심 — 다이아↓ + Riot ≥${SEASON_MIN}판 검증 안 됨. op.gg 최고 ${lab} 임시부여 · 수동확인`,
    games: curGames, confidence: 'low', suspect: true, source: 'hybrid', perSeason };
}
const APEX_T = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
function fallbackOpgg(prof, curGames) {
  if (prof.peak) return { found: true, gameName: prof.gameName, tag: prof.tag,
    suggestedTier: mapTierApexAware(prof.peak.tier, prof.peak.division, null),
    basis: `Riot 키없음 · 현재<200 → op.gg 최고 ${prof.peak.tier}${prof.peak.division || ''} (수동확인)`,
    games: curGames, confidence: 'low', suspect: true, source: 'opgg' };
  return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: null, basis: '랭크 기록 없음', games: 0, confidence: 'low', source: 'opgg' };
}

export async function fetchSeasonAverage(gameName, tagLine, region) {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error('RIOT_API_KEY 없음');
  const reg = (region || 'NA').toUpperCase();
  const regional = REGIONAL[reg] || 'americas';
  const acc = await riotGet(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, key);
  if (!acc) return { found: false, error: '소환사를 찾을 수 없음 (Riot ID 확인)' };

  // 최근 4창(~4개월씩) 솔랭 판수
  const now = Math.floor(Date.now() / 1000), WIN = 122 * 86400;
  const counts = [];
  for (let w = 0; w < 4; w++) {
    const end = now - w * WIN, start = end - WIN;
    counts.push(await countSolo(regional, acc.puuid, key, start, end));
  }
  // op.gg 시즌별 솔랭 티어 (최근 먼저)
  let seasons = [];
  try { seasons = (await fetchProfile(gameName, tagLine, region)).seasons || []; } catch {}

  // 창[i] ↔ 시즌[i] (최근 순 정렬) 대응, 100판+ 만
  const qualifying = [];
  for (let i = 0; i < 4; i++) {
    if (counts[i] > 100 && seasons[i]) {
      const ord = tierToOrd(seasons[i].tier, seasons[i].division);
      if (ord != null) qualifying.push({ ord, games: counts[i], tier: seasons[i].tier, division: seasons[i].division });
    }
  }
  if (qualifying.length) {
    const avg = qualifying.reduce((a, q) => a + q.ord, 0) / qualifying.length;
    return {
      found: true, gameName: acc.gameName, tag: acc.tagLine,
      suggestedTier: ordToKey(avg),
      basis: `최근 ${qualifying.length}시즌(100판+) 솔랭 평균`,
      games: qualifying.reduce((a, q) => a + q.games, 0),
      confidence: qualifying.length >= 2 ? 'high' : 'medium',
      source: 'riot-avg',
      seasonsUsed: qualifying.map((q) => `${q.tier}${q.division || ''} ${q.games}판`),
    };
  }
  // 100판+ 시즌 없음 → 현재 솔랭으로 폴백
  const rp = await fetchRiotProfile(gameName, tagLine, region);
  if (rp.found && rp.suggestedTier) rp.basis = (rp.basis || '현재') + ' (100판+ 시즌 없음→현재 기준)';
  return rp;
}
