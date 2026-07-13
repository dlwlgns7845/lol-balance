// op.gg 공식 MCP 호출 + 응답 파싱 + 티어 매핑 (서버 전용 — fetch 사용).
// 응답이 JSON이 아니라 op.gg 자체 포맷이라 정규식으로 추출한다.

const MCP_URL = 'https://mcp-api.op.gg/mcp';

const PROFILE_FIELDS = [
  'data.summoner.game_name', 'data.summoner.tagline',
  'data.summoner.league_stats[].game_type',
  'data.summoner.league_stats[].win', 'data.summoner.league_stats[].lose',
  'data.summoner.league_stats[].tier_info.tier',
  'data.summoner.league_stats[].tier_info.division',
  'data.summoner.league_stats[].tier_info.lp',
  'data.summoner.previous_seasons[].season_id',
  'data.summoner.previous_seasons[].tier_info.tier',
  'data.summoner.previous_seasons[].tier_info.division',
  'data.summoner.previous_seasons[].tier_info.lp',
  // 현재 시즌 최고티어 (휴먼강등 대응 — 현재 랭크는 떨어졌어도 이번 시즌 찍었던 최고점)
  'data.summoner.current_season_high_tiers[].rank_entries[].game_type',
  'data.summoner.current_season_high_tiers[].rank_entries[].high_rank_info.tier',
  'data.summoner.current_season_high_tiers[].rank_entries[].high_rank_info.division',
  'data.summoner.current_season_high_tiers[].rank_entries[].high_rank_info.lp',
];
// 과거 시즌별 최고티어는 별도 호출(클래스명 충돌 회피). 마감 아니라 그 시즌 찍었던 최고점.
const PEAK_FIELDS = [
  'data.summoner.previous_season_tiers[].season_id',
  'data.summoner.previous_season_tiers[].rank_entries[].game_type',
  'data.summoner.previous_season_tiers[].rank_entries[].high_rank_info.tier',
  'data.summoner.previous_season_tiers[].rank_entries[].high_rank_info.division',
  'data.summoner.previous_season_tiers[].rank_entries[].high_rank_info.lp',
];

const TIER_RANK = {
  CHALLENGER: 9, GRANDMASTER: 8, MASTER: 7, DIAMOND: 6, EMERALD: 5,
  PLATINUM: 4, GOLD: 3, SILVER: 2, BRONZE: 1, IRON: 0,
};
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

function tok(s) {
  if (s == null || s === 'null') return null;
  return s.replace(/"/g, '');
}
function num(s) {
  const v = tok(s);
  return v == null ? null : Number(v);
}

// op.gg (tier, division, lp) → 우리 점수표 키
export function mapTier(tier, division, lp) {
  if (!tier) return null;
  const T = tier.toUpperCase();
  if (APEX.has(T)) {
    if (lp == null) return 'M0';        // LP 모르면 마스터 최저 버킷
    if (lp >= 1800) return 'M1800+';
    return 'M' + Math.floor(lp / 100) * 100; // M0,M100,...,M1700
  }
  const d = Math.min(4, Math.max(1, division || 1));
  if (T === 'DIAMOND') return 'D' + d;
  if (T === 'EMERALD') return 'E' + d;
  if (T === 'PLATINUM') return 'P' + d;
  if (T === 'GOLD') return 'G' + d;
  if (T === 'SILVER') return d <= 2 ? 'S' + d : 'S3-';
  return 'S3-'; // BRONZE/IRON 등은 표 최저
}

function matchLeague(text, queue) {
  const re = new RegExp(
    `LeagueStat\\("${queue}",(null|\\d+),(null|\\d+),TierInfo\\((null|"[^"]*"),(null|\\d+),(null|\\d+)\\)\\)`
  );
  const m = text.match(re);
  if (!m) return null;
  const tier = tok(m[3]);
  return { win: num(m[1]), lose: num(m[2]), tier, division: num(m[4]), lp: num(m[5]) };
}

// op.gg MCP 응답 텍스트 → 구조화 + 제안 티어
export function parseProfile(text) {
  const head = text.match(/Summoner\("([^"]*)","([^"]*)"/);
  const solo = matchLeague(text, 'SOLORANKED');
  const flex = matchLeague(text, 'FLEXRANKED');

  // 전 시즌 최고 티어
  let peak = null;
  for (const m of text.matchAll(/TierInfo1\((null|"[^"]*"),(null|\d+)\)/g)) {
    const tier = tok(m[1]);
    if (!tier) continue;
    const rank = TIER_RANK[tier.toUpperCase()] ?? -1;
    if (!peak || rank > peak.rank) peak = { tier, division: num(m[2]), rank };
  }

  // 시즌별 솔랭 티어+LP (previous_seasons) — 최근 시즌 먼저. TierInfo(tier,division,lp)
  const seasons = [];
  for (const m of text.matchAll(/PreviousSeason\((\d+),\s*\w+\((null|"[^"]*"),\s*(null|\d+),\s*(null|\d+)\)\)/g)) {
    const tier = tok(m[2]);
    if (tier) seasons.push({ season_id: Number(m[1]), tier, division: num(m[3]), lp: num(m[4]) });
  }
  seasons.sort((a, b) => b.season_id - a.season_id);

  // 현재 시즌 최고티어 (current_season_high_tiers SOLORANKED high_rank_info)
  let curHigh = null;
  const ch = text.match(/CurrentSeasonHighTiers\(\d+,\[[\s\S]*?RankEntrie\("SOLORANKED",\w+\((null|"[^"]*"),(null|\d+),(null|\d+)/);
  if (ch) { const t = tok(ch[1]); if (t) curHigh = { tier: t, division: num(ch[2]), lp: num(ch[3]) }; }

  // 제안: 현재 솔랭 > 현재 자유랭 > 전시즌 최고
  let suggestedTier = null, basis = null, games = 0;
  if (solo && solo.tier) {
    suggestedTier = mapTier(solo.tier, solo.division, solo.lp); basis = '현재 솔랭';
    games = (solo.win || 0) + (solo.lose || 0);
  } else if (flex && flex.tier) {
    suggestedTier = mapTier(flex.tier, flex.division, flex.lp); basis = '현재 자유랭';
    games = (flex.win || 0) + (flex.lose || 0);
  } else if (peak) {
    suggestedTier = mapTier(peak.tier, peak.division, null); basis = '전시즌 최고';
  }

  // 신뢰도: 현재 시즌 판수 기반 (전시즌 최고 기반이면 현재 데이터 없음 → 낮음)
  let confidence = 'low';
  if (basis === '현재 솔랭' || basis === '현재 자유랭') {
    confidence = games >= 100 ? 'high' : games >= 30 ? 'medium' : 'low';
  }

  // 역대 최고 티어 키 — 현재티어·전시즌최고·현시즌최고·시즌별 중 가장 강한 키
  const peakCands = [suggestedTier,
    peak ? mapTierApexAware(peak.tier, peak.division, null) : null,
    curHigh ? mapTierApexAware(curHigh.tier, curHigh.division, curHigh.lp) : null,
    ...seasons.map((s) => mapTierApexAware(s.tier, s.division, s.lp))].filter(Boolean);
  const peakTier = peakCands.sort((a, b) => keyStrength(b) - keyStrength(a))[0] || suggestedTier;
  // 선정 기준별 키: 현재시즌 최고 / 지난 시즌
  const curHighTier = curHigh ? mapTierApexAware(curHigh.tier, curHigh.division, curHigh.lp) : (suggestedTier || null);
  const lastSeasonTier = seasons[0] ? mapTierApexAware(seasons[0].tier, seasons[0].division, seasons[0].lp) : null;
  return {
    gameName: head ? head[1] : null,
    tag: head ? head[2] : null,
    solo, flex,
    peak: peak ? { tier: peak.tier, division: peak.division } : null,
    curHigh,
    seasons,
    suggestedTier, peakTier, curHighTier, lastSeasonTier, basis, games, confidence,
  };
}

// 과거 시즌 apex(Master+)는 LP가 없어 한 버킷으로 뭉개지므로, 티어명으로 합리적 기본 버킷 부여
export function mapTierApexAware(tier, division, lp) {
  const T = (tier || '').toUpperCase();
  if (APEX.has(T) && lp == null) {
    if (T === 'CHALLENGER') return 'M1800+';   // 챌린저 = 엘리트 천장
    if (T === 'GRANDMASTER') return 'M600';    // GM ≈ 중상위
    return 'M0';                               // 마스터 최저
  }
  return mapTier(tier, division, lp);
}
// 내전 보정: "현재 시즌" 마스터+ 는 LP에 ×0.6 (M1200→720→M700). 마스터 1200 독주 방지.
//   → 여전히 마스터급이지만 저티어 팀과 밸런스 가능. 지난 시즌·다이아↓·LP없음은 그대로.
export const APEX_NERF = 0.6;
export function nerfCurrentApex(key) {
  if (!key || key[0] !== 'M') return key;
  const lp = key === 'M1800+' ? 1800 : (parseInt(key.slice(1), 10) || 0);
  const adj = Math.floor((lp * APEX_NERF) / 100) * 100;
  return adj >= 1800 ? 'M1800+' : 'M' + adj;
}

// 점수키 강도(정렬용): 같은 척도로 비교 → 최고키 선택
export function keyStrength(k) {
  if (!k) return -1;
  if (k === 'M1800+') return 2800;
  if (k[0] === 'M') return 1000 + (parseInt(k.slice(1), 10) || 0); // M0=1000 … M1700=2700
  const base = { S: 1, G: 2, P: 3, E: 4, D: 5 };
  if (k === 'S3-') return 0;
  const b = base[k[0]] ?? 0, div = parseInt(k.slice(1), 10) || 4;
  return b * 100 + (5 - div) * 10;
}

// 닉 → 티어 추정 (op.gg 단독, Riot 키 없을 때). 규칙:
// ① 현재 솔랭 ≥200판 → 현재 티어. ② <200판이면 과거 시즌 판수 검증 필요한데 op.gg는
// 과거 판수를 안 줌 → 못 함 → op.gg 최고티어로 주고 수동확인(의심). (정밀판은 riot 하이브리드)
export async function fetchTierEstimate(gameName, tagLine, region) {
  const prof = await fetchProfile(gameName, tagLine, region);
  if (!prof.found) return prof;
  const cur = prof.solo;
  const curGames = cur ? (cur.win || 0) + (cur.lose || 0) : 0;

  if (cur && cur.tier && curGames >= 200) {
    const k0 = mapTierApexAware(cur.tier, cur.division, cur.lp);
    const k = nerfCurrentApex(k0); // 현재 시즌이므로 마스터+면 ×0.6
    return { found: true, gameName: prof.gameName, tag: prof.tag,
      suggestedTier: k,
      basis: `현재 솔랭 ${cur.tier}${cur.division || ''} ${curGames}판${k !== k0 ? ` · 내전보정 ×0.6→${k}` : ''}`,
      games: curGames, confidence: 'high', source: 'opgg' };
  }
  // 현재<200: 과거 판수검증은 Riot 필요(여기선 불가)지만 현재시즌 최고티어(curHigh)는 op.gg가 줌.
  // curHigh vs op.gg 최고티어 중 강한 쪽 (과거 판수 미검증이라 의심 처리)
  const cand = [];
  if (prof.curHigh && prof.curHigh.tier) cand.push({ ...prof.curHigh, cur: true, label: `현재시즌 최고 ${prof.curHigh.tier}${prof.curHigh.division || ''}` });
  if (prof.peak) cand.push({ tier: prof.peak.tier, division: prof.peak.division, lp: null, cur: false, label: `op.gg 최고 ${prof.peak.tier}${prof.peak.division || ''}` });
  if (cand.length) {
    cand.forEach((c) => { let k = mapTierApexAware(c.tier, c.division, c.lp); if (c.cur) k = nerfCurrentApex(k); c.key = k; c.strength = keyStrength(c.key); }); // 현재시즌만 ×0.6
    cand.sort((a, b) => b.strength - a.strength);
    return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: cand[0].key,
      basis: `현재 ${curGames}판<200 · Riot키없어 과거판수 미검증 → ${cand[0].label} (수동확인)`,
      games: curGames, confidence: 'low', suspect: true, apexNoLp: APEX.has((cand[0].tier || '').toUpperCase()) && cand[0].lp == null, source: 'opgg' };
  }
  return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: null, basis: '랭크 기록 없음', games: 0, confidence: 'low', source: 'opgg' };
}

async function mcpCall(method, params) {
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`op.gg MCP HTTP ${r.status}`);
  return r.json();
}

// 과거 시즌별 SOLO 최고티어 파싱 (PEAK_FIELDS 단독 응답 → PreviousSeasonTier 클래스)
function parsePeaks(text) {
  const map = {};
  for (const m of text.matchAll(/PreviousSeasonTier\((\d+),\[RankEntrie\("SOLORANKED",HighRankInfo\((null|"[^"]*"),(null|\d+),(null|\d+)\)/g)) {
    const tier = tok(m[2]);
    if (tier) map[Number(m[1])] = { tier, division: num(m[3]), lp: num(m[4]) };
  }
  return map;
}

// 닉네임 → 프로필 (서버에서 호출)
export async function fetchProfile(gameName, tagLine, region) {
  const args = { game_name: gameName, tag_line: tagLine, region };
  const res = await mcpCall('tools/call', { name: 'lol_get_summoner_profile', arguments: { ...args, desired_output_fields: PROFILE_FIELDS } });
  if (res.error) return { found: false, error: res.error.message || '조회 실패' };
  const text = res.result?.content?.[0]?.text || '';
  const parsed = parseProfile(text);
  if (!parsed.gameName) return { found: false, error: '소환사를 찾을 수 없음' };
  // 과거 시즌 최고티어 별도 호출 → seasons의 '마감'을 '최고점'으로 덮어씀
  try {
    const res2 = await mcpCall('tools/call', { name: 'lol_get_summoner_profile', arguments: { ...args, desired_output_fields: PEAK_FIELDS } });
    const peaks = parsePeaks(res2.result?.content?.[0]?.text || '');
    parsed.seasons.forEach((s) => {
      const pk = peaks[s.season_id];
      if (pk) { s.endTier = s.tier; s.endLp = s.lp; s.tier = pk.tier; s.division = pk.division; s.lp = pk.lp; s.isPeak = true; }
    });
  } catch { /* 최고티어 못 받으면 마감티어 그대로 */ }
  return { found: true, ...parsed };
}
