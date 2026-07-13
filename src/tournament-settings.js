// 멸망전 커스텀 설정 — 정규화 · 참가자격 검증 · 시드 배정. 순수 로직(DB 접근 X).
// 주최자가 조립하는 옵션 묶음을 안전한 형태로 정규화하고, 신청/대진에서 재사용.
import { TIER_ORDER } from './table.js';

export const FORMATS = ['single_elim', 'double_elim', 'group_stage'];
export const SEEDINGS = ['order', 'tier', 'random'];
export const FORMATIONS = ['roster', 'auction'];

export const TIER_BASES = ['current', 'peak']; // 티어 판정 기준: 현재 시즌 / 역대 최고
export const REGIONS = ['NA', 'KR', 'EUW', 'EUNE', 'JP', 'OCE', 'BR', 'LAN', 'LAS', 'TR', 'RU', 'VN']; // 조회 지역

export const DEFAULT_SETTINGS = {
  eligibility: { minLevel: 0, tierCap: null, tierFloor: null, rosterMin: 5, rosterMax: 7, tierBasis: 'current', minGames: 0, region: 'NA', allowFlex: true },
  format: 'single_elim',
  bestOf: 1,
  seeding: 'order',
  scoring: { win: 3, draw: 1, loss: 0 },
  teamFormation: 'roster',
  groups: { count: 2, advance: 2 },
  auction: { budget: 1000 }, // 경매 드래프트 팀별 포인트 예산
};

const clampInt = (v, d, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const tierKey = (v) => (TIER_ORDER.includes(v) ? v : null);

// 원본(신뢰 불가) → 안전한 설정 객체. 잘못된 값은 기본값으로 대체.
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const el = s.eligibility && typeof s.eligibility === 'object' ? s.eligibility : {};
  const sc = s.scoring && typeof s.scoring === 'object' ? s.scoring : {};
  const gr = s.groups && typeof s.groups === 'object' ? s.groups : {};
  return {
    eligibility: {
      minLevel: clampInt(el.minLevel, 0, 0, 1000),
      tierCap: tierKey(el.tierCap),
      tierFloor: tierKey(el.tierFloor),
      rosterMin: clampInt(el.rosterMin, 5, 1, 10),
      rosterMax: clampInt(el.rosterMax, 7, 1, 10),
      tierBasis: TIER_BASES.includes(el.tierBasis) ? el.tierBasis : 'current',
      minGames: clampInt(el.minGames, 0, 0, 10000),
      region: REGIONS.includes((el.region || '').toUpperCase()) ? el.region.toUpperCase() : 'NA',
      allowFlex: el.allowFlex !== false, // 기본 true (자유랭 포함)
    },
    format: FORMATS.includes(s.format) ? s.format : 'single_elim',
    bestOf: [1, 3, 5].includes(Number(s.bestOf)) ? Number(s.bestOf) : 1,
    seeding: SEEDINGS.includes(s.seeding) ? s.seeding : 'order',
    scoring: { win: clampInt(sc.win, 3, 0, 10), draw: clampInt(sc.draw, 1, 0, 10), loss: clampInt(sc.loss, 0, 0, 10) },
    teamFormation: FORMATIONS.includes(s.teamFormation) ? s.teamFormation : 'roster',
    groups: { count: clampInt(gr.count, 2, 1, 8), advance: clampInt(gr.advance, 2, 1, 8) },
    auction: { budget: clampInt((s.auction || {}).budget, 1000, 1, 1000000) },
  };
}

// 티어 랭크(작을수록 강함). 미인식 → null.
export const tierRank = (t) => { const i = TIER_ORDER.indexOf(t); return i < 0 ? null : i; };

// 팀 전력 = 멤버 티어 랭크 평균(작을수록 강함). 티어 없음 → null.
export function teamStrength(memberTiers) {
  const ranks = (memberTiers || []).map(tierRank).filter((r) => r != null);
  if (!ranks.length) return null;
  return ranks.reduce((s, r) => s + r, 0) / ranks.length;
}

// 참가팀 자격 검증 → { ok, errors[] }. 티어 미입력/미인식 항목은 skip(느슨).
export function validateEligibility(settings, members) {
  const el = normalizeSettings(settings).eligibility;
  const errors = [];
  const n = (members || []).length;
  if (n < el.rosterMin) errors.push(`로스터가 최소 ${el.rosterMin}명이어야 해요 (현재 ${n}명)`);
  if (n > el.rosterMax) errors.push(`로스터는 최대 ${el.rosterMax}명까지예요 (현재 ${n}명)`);
  const capR = tierRank(el.tierCap);     // 이보다 강하면(rank < capR) 탈락
  const floorR = tierRank(el.tierFloor); // 이보다 약하면(rank > floorR) 탈락
  const basisKr = el.tierBasis === 'peak' ? '최고티어' : '현재티어';
  (members || []).forEach((m) => {
    const r = tierRank(m.tier);
    if (r != null) {
      if (capR != null && r < capR) errors.push(`${m.game_name || '팀원'}: ${basisKr} 상한(${el.tierCap}) 초과 (${m.tier})`);
      if (floorR != null && r > floorR) errors.push(`${m.game_name || '팀원'}: ${basisKr} 하한(${el.tierFloor}) 미달 (${m.tier})`);
    }
    if (el.minGames > 0 && m.games != null && Number(m.games) < el.minGames) {
      errors.push(`${m.game_name || '팀원'}: 현재 시즌 판수 부족 (${m.games} < ${el.minGames})`);
    }
  });
  return { ok: errors.length === 0, errors };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 시드 배정 → [{ id, seed }]. teams: [{ id, created_at, strength? }] (strength 작을수록 강함)
export function seedTeams(teams, seeding) {
  const mode = SEEDINGS.includes(seeding) ? seeding : 'order';
  let arr = teams.slice();
  if (mode === 'tier') {
    arr.sort((a, b) => (a.strength ?? 1e9) - (b.strength ?? 1e9) || String(a.created_at).localeCompare(String(b.created_at)));
  } else if (mode === 'random') {
    arr = shuffle(arr);
  } // order = created_at 순(입력 그대로)
  return arr.map((t, i) => ({ id: t.id, seed: i + 1 }));
}
