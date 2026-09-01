// op.gg 공식 MCP 호출 + 응답 파싱 + 티어 매핑 (서버 전용 — fetch 사용).
// 응답이 JSON이 아니라 op.gg 자체 포맷이라 정규식으로 추출한다.

const MCP_URL = 'https://mcp-api.op.gg/mcp';

const PROFILE_FIELDS = [
  'data.summoner.game_name', 'data.summoner.tagline', 'data.summoner.level',
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
  // 소환사 레벨 (베스트에포트: Summoner("name","tag",<level> 또는 level=N. 못 찾으면 null → 최소레벨 검증 스킵)
  const lvM = text.match(/Summoner\("[^"]*","[^"]*",\s*(\d+)/) || text.match(/[Ll]evel["\s:=]+(\d+)/);
  const level = lvM ? Number(lvM[1]) : null;
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
    suggestedTier, peakTier, curHighTier, lastSeasonTier, level, basis, games, confidence,
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
// ⚠️ 이 보정은 '현재 시즌' 인플레 대응 — 2026 시즌 한정 정책. 과거 시즌 티어엔 절대 적용 안 됨(bestRecent3에서 cur만 보정).
//   시즌이 바뀌어 인플레가 정상화되면(2027~) 이 값을 false로 바꿔 현재 시즌 보정을 끈다.
export const NERF_CURRENT_SEASON = true;
export function nerfCurrentApex(key) {
  if (!NERF_CURRENT_SEASON) return key; // 시즌 보정 off → 원본 그대로
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

// 닉 → 티어 추정 (op.gg 단독, Riot 키 없을 때). 규칙 (2026-07-15 개정):
// ① 현재 솔랭 ≥200판 → **근 3시즌(현시즌 최고 + 직전 2시즌 최고) 중 최고 티어**.
//    (개정 전엔 현재 티어 — 이번 시즌 눌러앉기/강등 억제를 위해 최근 폼의 천장으로)
// ② <200판이면 과거 시즌 판수 검증 필요한데 op.gg는 과거 판수를 안 줌 → 못 함 →
//    op.gg 최고티어로 주고 수동확인(의심). (정밀판은 riot 하이브리드)

// 근 3시즌 후보(현시즌 최고 + 직전 2시즌) 중 배정키가 가장 높은 것.
// 현시즌 후보만 마스터+ ×0.6 내전보정(nerf) 적용 — 비교도 보정 후 키로 일관되게.
export function bestRecent3(prof) {
  const cands = [];
  const ch = prof.curHigh && prof.curHigh.tier ? prof.curHigh : (prof.solo && prof.solo.tier ? prof.solo : null);
  if (ch) {
    const k0 = mapTierApexAware(ch.tier, ch.division, ch.lp);
    cands.push({ key: nerfCurrentApex(k0), raw: k0, cur: true, label: `현시즌 ${ch.tier}${ch.division || ''}` });
  }
  for (const s of (prof.seasons || []).slice(0, 2)) {
    const k = mapTierApexAware(s.tier, s.division, s.lp);
    cands.push({ key: k, raw: k, cur: false, label: `S${s.season_id} ${s.tier}${s.division || ''}` });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => keyStrength(b.key) - keyStrength(a.key));
  return cands[0];
}

export async function fetchTierEstimate(gameName, tagLine, region) {
  const prof = await fetchProfile(gameName, tagLine, region);
  if (!prof.found) return prof;
  const cur = prof.solo;
  const curGames = cur ? (cur.win || 0) + (cur.lose || 0) : 0;
  // 티어 선정 기준(현재/역대/전시즌)·레벨은 프로필에서 그대로 전달 (멸망전 자격 판정용)
  const extra = { peakTier: prof.peakTier, curHighTier: prof.curHighTier, lastSeasonTier: prof.lastSeasonTier, level: prof.level ?? null };

  // 현재 시즌 '랭크'(솔랭 or 현시즌 최고티어)가 있으면 근 3시즌 최고로 판정 → 현시즌 마스터+는 내전보정(×0.6) 적용.
  // ⚠️ op.gg league_stats.win/lose 는 '현재 스플릿'만 세서 시즌 총 판수가 커도(예: 700판) 리셋 직후엔 0~적게 잡힘.
  //   → 판수 게이트만으로 판정하면 안 됨. 또 solo(league_stats)가 비어도 curHigh(현시즌 최고)가 있으면 현시즌 데이터이므로
  //     반드시 이 경로로 태워 보정한다. (안 그러면 역대최고 폴백으로 빠져 마스터 고LP가 raw로 과대배정됨 — Diamond#0416 케이스)
  const curTierName = (cur && cur.tier) ? `${cur.tier}${cur.division || ''}`
    : (prof.curHigh && prof.curHigh.tier) ? `${prof.curHigh.tier}${prof.curHigh.division || ''}(현시즌 최고)` : null;
  if (curTierName) {
    const best = bestRecent3(prof);
    if (best) {
      const enough = curGames >= 200;
      const nerf = best.key !== best.raw ? ` · 내전보정 ×${APEX_NERF}→${best.key}` : '';
      return { found: true, gameName: prof.gameName, tag: prof.tag,
        suggestedTier: best.key, ...extra,
        basis: `${enough ? `현재 ${curGames}판≥200` : `현재 시즌 랭크 ${curTierName}`} → 근 3시즌 최고 (${best.label})${nerf}`,
        games: curGames, confidence: enough ? 'high' : 'medium', source: 'opgg' };
    }
  }
  // 현재 시즌 솔랭 언랭(랭크 없음) → 역대 최고 티어 폴백 (수동 확인 권장)
  if (prof.peakTier) {
    return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: prof.peakTier, ...extra,
      basis: `현재 시즌 랭크 없음 → 역대 최고 티어 (${prof.peakTier})`,
      games: curGames, confidence: 'low', source: 'opgg' };
  }
  return { found: true, gameName: prof.gameName, tag: prof.tag, suggestedTier: null, ...extra, basis: '랭크 기록 없음', games: 0, confidence: 'low', source: 'opgg' };
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
