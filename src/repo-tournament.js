// 멸망전(대회) DB 접근 — 내전 repo와 분리. 서버 전용(service_role).
import { db } from './supabase.js';
import { generateSingleElim, nextSlot, generateGroups, groupStandings, knockoutSeeds, groupsComplete,
  generateDoubleElim, deParamsFromMatches, wbWinTo, wbLoseTo, lbWinTo } from './bracket.js';
import { normalizeSettings, validateEligibility, seedTeams, teamStrength, tierRank } from './tournament-settings.js';
import { tierPts } from './engine.js';
import { POS, TABLE } from './table.js';

const isMissingCol = (e) => e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|settings/.test(e.message || ''));

export async function listTournaments() {
  const { data, error } = await db().from('tournaments').select('*').order('created_at', { ascending: false });
  if (error) { if (error.code === '42P01') return []; throw error; } // 테이블 미생성(SQL 실행 전) → 빈 목록
  // 팀 수(승인) 카운트
  const ids = (data || []).map((t) => t.id);
  const counts = {};
  if (ids.length) {
    const { data: teams } = await db().from('tournament_teams').select('tournament_id, status').in('tournament_id', ids);
    (teams || []).forEach((t) => { if (t.status === 'approved') counts[t.tournament_id] = (counts[t.tournament_id] || 0) + 1; });
  }
  return (data || []).map((t) => ({ ...t, approvedTeams: counts[t.id] || 0 }));
}

export async function createTournament(ownerId, b) {
  const base = {
    owner_id: ownerId || null, name: (b.name || '').trim() || '새 대회',
    max_teams: [4, 8, 16, 32].includes(Number(b.max_teams)) ? Number(b.max_teams) : 8,
    team_size: Number(b.team_size) || 5, tier_cap: b.tier_cap || null,
    starts_at: b.starts_at || null,
  };
  const row = { ...base, settings: normalizeSettings(b.settings) };
  let { data, error } = await db().from('tournaments').insert(row).select().single();
  if (error && isMissingCol(error)) { // settings 컬럼 미생성(SQL 실행 전) → 없이 재시도
    ({ data, error } = await db().from('tournaments').insert(base).select().single());
  }
  if (error) throw error;
  return data;
}

export async function updateTournament(id, patch) {
  const clean = {};
  ['notice', 'status', 'name', 'tier_cap'].forEach((k) => { if (k in patch) clean[k] = patch[k]; });
  if ('settings' in patch) clean.settings = normalizeSettings(patch.settings);
  let { error } = await db().from('tournaments').update(clean).eq('id', id);
  if (error && isMissingCol(error) && 'settings' in clean) { // settings 컬럼 미생성 → 없이 재시도
    delete clean.settings;
    ({ error } = await db().from('tournaments').update(clean).eq('id', id));
  }
  if (error) throw error;
}

// ── 공동운영(관리자) — 방(room_members)과 동일 매커니즘 ──
// 로그인 유저가 대회를 열람하면 viewer로 자동 등록 → 대회장이 admin으로 승격.
export async function registerTournamentMember(tournamentId, user) {
  if (!tournamentId || !user?.id) return;
  const r = await db().from('tournament_members').select('role').eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle();
  if (r.error) return; // 테이블 미생성(마이그레이션 전) → 무시
  if (r.data) { await db().from('tournament_members').update({ email: user.email || null, name: user.name || null }).eq('tournament_id', tournamentId).eq('user_id', user.id); return; }
  await db().from('tournament_members').insert({ tournament_id: tournamentId, user_id: user.id, email: user.email || null, name: user.name || null, role: 'viewer' });
}

export async function tournamentRole(tournamentId, userId) {
  if (!userId) return null;
  const { data: t } = await db().from('tournaments').select('owner_id').eq('id', tournamentId).maybeSingle();
  if (t?.owner_id === userId) return 'owner';
  const r = await db().from('tournament_members').select('role').eq('tournament_id', tournamentId).eq('user_id', userId).maybeSingle();
  return r.error ? null : (r.data?.role || null);
}

export async function listTournamentMembers(tournamentId) {
  const r = await db().from('tournament_members').select('user_id, email, name, role, created_at').eq('tournament_id', tournamentId).order('created_at');
  return r.error ? [] : (r.data || []);
}

export async function setTournamentMemberRole(tournamentId, userId, role, info = {}) {
  if (!['admin', 'viewer'].includes(role)) throw new Error('role은 admin/viewer');
  if (!userId) throw new Error('user_id 필요');
  const { data: t } = await db().from('tournaments').select('owner_id').eq('id', tournamentId).maybeSingle();
  if (t?.owner_id === userId) throw new Error('대회장 역할은 바꿀 수 없어요');
  // 방문 없이 바로 지정: 이미 있으면 역할만, 없으면 새로 등록(이름/이메일은 유저 목록에서).
  const { data: exist } = await db().from('tournament_members').select('user_id').eq('tournament_id', tournamentId).eq('user_id', userId).maybeSingle();
  if (exist) {
    const { error } = await db().from('tournament_members').update({ role }).eq('tournament_id', tournamentId).eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await db().from('tournament_members').insert({ tournament_id: tournamentId, user_id: userId, role, email: info.email ?? null, name: info.name ?? null });
    if (error) throw error;
  }
}

// 사이트에 로그인한 적 있는 유저 목록(방 입장자 취합) — 대회장이 공동운영자로 지정할 후보.
export async function listKnownUsers() {
  const { data } = await db().from('room_members').select('user_id, name, email').order('name');
  const map = new Map();
  (data || []).forEach((m) => { if (m.user_id && !map.has(m.user_id)) map.set(m.user_id, { user_id: m.user_id, name: m.name || null, email: m.email || null }); });
  return [...map.values()];
}

export async function tournamentOwnerId(id) {
  const { data } = await db().from('tournaments').select('owner_id').eq('id', id).maybeSingle();
  return data?.owner_id ?? undefined; // undefined = 대회 없음
}

export async function getTournament(id) {
  const { data: tournament, error } = await db().from('tournaments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!tournament) return null;
  const { data: teams } = await db().from('tournament_teams').select('*').eq('tournament_id', id).order('created_at');
  const teamIds = (teams || []).map((t) => t.id);
  let members = [];
  if (teamIds.length) { const r = await db().from('tournament_team_members').select('*').in('team_id', teamIds); members = r.data || []; }
  const { data: matches } = await db().from('tournament_matches').select('*').eq('tournament_id', id).order('round').order('pos');
  const teamsWithMembers = (teams || []).map((t) => ({ ...t, members: members.filter((m) => m.team_id === t.id) }));
  const poolRes = await db().from('tournament_pool').select('*').eq('tournament_id', id).order('created_at');
  const pool = poolRes.error ? [] : (poolRes.data || []); // 테이블 미생성(경매 SQL 전) → 빈 풀
  const aucRes = await db().from('tournament_auction').select('*').eq('tournament_id', id).maybeSingle();
  const auction = aucRes.error ? null : (aucRes.data || null);
  const gamesRes = await db().from('tournament_games').select('*').eq('tournament_id', id).order('played_at', { ascending: false });
  const games = gamesRes.error ? [] : (gamesRes.data || []); // 테이블 미생성(마이그레이션 전) → 빈 목록
  return { tournament, teams: teamsWithMembers, matches: matches || [], pool, auction, games };
}

export async function applyTeam(tournamentId, b) {
  const { data: t } = await db().from('tournaments').select('*').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  if (t.status !== 'recruiting') throw new Error('신청이 마감된 대회예요');
  const name = (b.name || '').trim();
  if (!name) throw new Error('팀 이름을 입력하세요');
  const settings = normalizeSettings(t.settings);
  // 경매 모드: 주장 팀만 등록(로스터는 경매로 채움), 예산 부여
  if (settings.teamFormation === 'auction') {
    const ins = { tournament_id: tournamentId, name, captain: b.captain || null, budget: settings.auction.budget };
    let { data: team, error } = await db().from('tournament_teams').insert(ins).select().single();
    if (error && /budget/i.test(error.message || '')) { // budget 컬럼 미생성 → 경매 마이그레이션 필요
      throw new Error('경매 드래프트를 쓰려면 마이그레이션(tournament-auction-schema.sql)을 먼저 실행하세요');
    }
    if (error) throw error;
    return team;
  }
  const members = (b.members || []).filter((m) => (m.game_name || '').trim());
  if (!members.length) throw new Error('로스터를 1명 이상 입력하세요');
  const chk = validateEligibility(t.settings, members); // 주최자 참가자격 규칙
  if (!chk.ok) throw new Error(chk.errors.join('\n'));
  const { data: team, error } = await db().from('tournament_teams')
    .insert({ tournament_id: tournamentId, name, captain: b.captain || null }).select().single();
  if (error) throw error;
  const rows = members.map((m) => ({ team_id: team.id, game_name: (m.game_name || '').trim(), tag_line: m.tag_line || null, tier: m.tier || null, role: m.role || null }));
  await db().from('tournament_team_members').insert(rows);
  return team;
}

// ── 경매 드래프트 ──

// 선수 풀에 신청 (개인 단위, 인게임 티어 배정 후). 주최자 참가자격 검증.
export async function addPoolPlayer(tournamentId, b) {
  const { data: t } = await db().from('tournaments').select('status, settings').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  if (t.status !== 'recruiting') throw new Error('모집이 마감된 대회예요');
  const game_name = (b.game_name || '').trim();
  if (!game_name) throw new Error('게임 닉네임을 입력하세요');
  // 자격 검증 (티어 상/하한 · 최소 판수). 로스터 인원 조건은 개인 신청엔 미적용.
  const chk = validateEligibility(t.settings, [{ game_name, tier: b.tier || null, games: b.games ?? null, level: b.level ?? null }]);
  const relevant = chk.errors.filter((e) => !e.includes('로스터'));
  if (relevant.length) throw new Error(relevant.join('\n'));
  const row = { tournament_id: tournamentId, game_name, tag_line: b.tag_line || null, tier: b.tier || null, role: b.role || null, user_id: b.user_id ?? null };
  let ins = await db().from('tournament_pool').insert(row).select().single();
  if (ins.error && /user_id/i.test(ins.error.message || '')) { const { user_id, ...r } = row; ins = await db().from('tournament_pool').insert(r).select().single(); } // user_id 컬럼 미생성 폴백
  if (ins.error) { if (/tournament_pool|does not exist/i.test(ins.error.message || '')) throw new Error('경매 마이그레이션(tournament-auction-schema.sql)을 먼저 실행하세요'); throw ins.error; }
  return ins.data;
}

// 점수제 팀 제출: 신청자 5명(라인별)을 골라 합계 점수 ≤ 상한이면 팀 등록 + 풀에서 소비.
export async function submitScoreTeam(tournamentId, b) {
  const { data: t } = await db().from('tournaments').select('status, settings').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  if (t.status !== 'recruiting') throw new Error('모집이 마감된 대회예요');
  const cap = normalizeSettings(t.settings).scoreCap;
  const name = (b.name || '').trim();
  if (!name) throw new Error('팀 이름을 입력하세요');
  const members = (b.members || []).filter((m) => m.poolId && m.role);
  if (members.length !== 5) throw new Error('5개 라인을 모두 채워야 해요');
  const lanes = members.map((m) => m.role);
  if (new Set(lanes).size !== 5 || !lanes.every((l) => POS.includes(l))) throw new Error('탑/정글/미드/원딜/서폿 각 1명씩이어야 해요');
  const ids = members.map((m) => m.poolId);
  const { data: ps } = await db().from('tournament_pool').select('*').in('id', ids);
  if (!ps || ps.length !== 5) throw new Error('선수를 찾을 수 없어요');
  if (ps.some((p) => p.sold_to)) throw new Error('이미 다른 팀에 속한 선수가 있어요');
  const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
  let total = 0;
  for (const m of members) { const p = byId[m.poolId]; if (!TABLE[p.tier]) throw new Error(`${p.game_name}: 티어 미확인 — 배정 후 가능`); total += tierPts(p.tier, POS.indexOf(m.role)); }
  total = Math.round(total * 10) / 10;
  if (total > cap) throw new Error(`팀 합계 ${total}점이 상한 ${cap}점을 초과해요`);
  const { data: team, error } = await db().from('tournament_teams').insert({ tournament_id: tournamentId, name, status: 'approved' }).select().single();
  if (error) throw error;
  const rows = members.map((m) => { const p = byId[m.poolId]; return { team_id: team.id, game_name: p.game_name, tag_line: p.tag_line, tier: p.tier, role: m.role }; });
  await db().from('tournament_team_members').insert(rows);
  await db().from('tournament_pool').update({ sold_to: team.id }).in('id', ids); // 풀에서 소비(중복 배정 방지)
  return getTournament(tournamentId);
}

// ── 점수제 팀: 방장 승인제 (합류 신청 → 방장 수락). 동의 없이 남을 팀에 못 넣게. ──
const MIGRATE_SCORE = '점수제 팀 마이그레이션(tournament-score-teams-schema.sql)을 먼저 실행하세요';
const isScoreColErr = (e) => e && /pool_id|join_status/i.test(e.message || '');

async function scoreCtx(tournamentId) {
  const { data: t } = await db().from('tournaments').select('status, settings').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  const s = normalizeSettings(t.settings);
  if (s.teamFormation !== 'score') throw new Error('점수제 대회가 아니에요');
  return { t, cap: s.scoreCap };
}
async function myPoolEntry(tournamentId, userId) {
  if (!userId) return null;
  const { data } = await db().from('tournament_pool').select('*').eq('tournament_id', tournamentId).eq('user_id', userId).order('created_at').limit(1);
  return (data && data[0]) || null;
}
async function teamMembersRaw(teamId) {
  const { data } = await db().from('tournament_team_members').select('*').eq('team_id', teamId);
  return data || [];
}
function teamTotalPts(approvedMembers) {
  let total = 0;
  approvedMembers.forEach((m) => { if (m.role && TABLE[m.tier]) total += tierPts(m.tier, POS.indexOf(m.role)); });
  return Math.round(total * 10) / 10;
}
async function clearMyRequests(tournamentId, userId) { // 이 유저의 대기 합류신청 정리 (한 번에 한 곳)
  const { data: teams } = await db().from('tournament_teams').select('id').eq('tournament_id', tournamentId);
  const ids = (teams || []).map((x) => x.id);
  if (ids.length) await db().from('tournament_team_members').delete().eq('user_id', userId).eq('join_status', 'requested').in('team_id', ids);
}

// 팀 만들기 — 로그인 신청자가 방장이 되어 팀 생성(본인 라인 배정).
export async function createScoreTeam(tournamentId, user, b) {
  const { t } = await scoreCtx(tournamentId);
  if (t.status !== 'recruiting') throw new Error('모집이 마감된 대회예요');
  const name = (b.name || '').trim();
  if (!name) throw new Error('팀 이름을 입력하세요');
  if (!POS.includes(b.lane)) throw new Error('본인 라인을 선택하세요');
  const mine = await myPoolEntry(tournamentId, user.id);
  if (!mine) throw new Error('먼저 선수 신청을 해주세요');
  if (mine.sold_to) throw new Error('이미 다른 팀에 속해 있어요');
  await clearMyRequests(tournamentId, user.id);
  const { data: team, error } = await db().from('tournament_teams')
    .insert({ tournament_id: tournamentId, name, is_captain_team: true, captain_user_id: user.id, status: 'pending' }).select().single();
  if (error) { if (/is_captain|captain_user/i.test(error.message || '')) throw new Error('실시간 경매 마이그레이션(tournament-auction-live-schema.sql)을 먼저 실행하세요'); throw error; }
  const mi = await db().from('tournament_team_members').insert({ team_id: team.id, game_name: mine.game_name, tag_line: mine.tag_line, tier: mine.tier, role: b.lane, pool_id: mine.id, user_id: user.id, join_status: 'approved' });
  if (mi.error) { await db().from('tournament_teams').delete().eq('id', team.id); if (isScoreColErr(mi.error)) throw new Error(MIGRATE_SCORE); throw mi.error; }
  await db().from('tournament_pool').update({ sold_to: team.id }).eq('id', mine.id);
  return getTournament(tournamentId);
}

// 합류 신청 — 로그인 신청자가 특정 팀 특정 라인에 신청(대기 상태).
export async function requestJoinScoreTeam(tournamentId, user, b) {
  const { t } = await scoreCtx(tournamentId);
  if (t.status !== 'recruiting') throw new Error('모집이 마감된 대회예요');
  if (!POS.includes(b.lane)) throw new Error('희망 라인을 선택하세요');
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', b.teamId).maybeSingle();
  if (!team || team.tournament_id !== tournamentId || !team.is_captain_team) throw new Error('팀을 찾을 수 없어요');
  if (team.status !== 'pending') throw new Error('이미 확정된 팀이에요');
  const mine = await myPoolEntry(tournamentId, user.id);
  if (!mine) throw new Error('먼저 선수 신청을 해주세요');
  if (mine.sold_to) throw new Error('이미 다른 팀에 속해 있어요');
  const members = await teamMembersRaw(team.id);
  if (members.some((m) => m.join_status !== 'requested' && m.role === b.lane)) throw new Error('그 라인은 이미 찼어요');
  if (members.some((m) => m.join_status === 'requested' && m.user_id === user.id)) throw new Error('이미 이 팀에 신청했어요');
  await clearMyRequests(tournamentId, user.id);
  const ins = await db().from('tournament_team_members').insert({ team_id: team.id, game_name: mine.game_name, tag_line: mine.tag_line, tier: mine.tier, role: b.lane, pool_id: mine.id, user_id: user.id, join_status: 'requested' });
  if (ins.error) { if (isScoreColErr(ins.error)) throw new Error(MIGRATE_SCORE); throw ins.error; }
  return getTournament(tournamentId);
}

// 합류 신청 취소 (본인)
export async function cancelJoinRequest(tournamentId, user, b) {
  const { data: m } = await db().from('tournament_team_members').select('*').eq('id', b.memberId).maybeSingle();
  if (!m) return getTournament(tournamentId);
  if (m.user_id !== user.id) throw new Error('본인 신청만 취소할 수 있어요');
  if (m.join_status !== 'requested') throw new Error('이미 처리된 신청이에요');
  await db().from('tournament_team_members').delete().eq('id', m.id);
  return getTournament(tournamentId);
}

// 합류 신청 수락/거절 (방장 또는 운영자)
export async function resolveJoinRequest(tournamentId, user, isManager, b) {
  const { cap } = await scoreCtx(tournamentId);
  const { data: m } = await db().from('tournament_team_members').select('*').eq('id', b.memberId).maybeSingle();
  if (!m || m.join_status !== 'requested') throw new Error('처리할 신청이 없어요');
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', m.team_id).maybeSingle();
  if (!team || team.tournament_id !== tournamentId) throw new Error('팀을 찾을 수 없어요');
  if (!isManager && team.captain_user_id !== user.id) throw new Error('방장만 수락/거절할 수 있어요');
  if (b.decision === 'reject') { await db().from('tournament_team_members').delete().eq('id', m.id); return getTournament(tournamentId); }
  if (team.status !== 'pending') throw new Error('이미 확정된 팀이에요');
  const { data: p } = await db().from('tournament_pool').select('*').eq('id', m.pool_id).maybeSingle();
  if (!p) throw new Error('신청자를 찾을 수 없어요');
  if (p.sold_to) throw new Error('이미 다른 팀에 배정된 선수예요');
  const approved = (await teamMembersRaw(team.id)).filter((x) => x.join_status !== 'requested');
  if (approved.some((x) => x.role === m.role)) throw new Error('그 라인은 이미 찼어요');
  if (approved.length >= 5) throw new Error('이미 5명이 다 찼어요');
  if (!TABLE[m.tier]) throw new Error(`${m.game_name}: 티어 미확인 — 배정 불가`);
  if (Math.round((teamTotalPts(approved) + tierPts(m.tier, POS.indexOf(m.role))) * 10) / 10 > cap) throw new Error(`합계가 상한 ${cap}점을 초과해요`);
  await db().from('tournament_team_members').update({ join_status: 'approved' }).eq('id', m.id);
  await db().from('tournament_pool').update({ sold_to: team.id }).eq('id', m.pool_id);
  await clearMyRequests(tournamentId, m.user_id); // 다른 팀 대기 신청 정리
  return getTournament(tournamentId);
}

// 멤버 내보내기 (방장 또는 운영자) — 방장 본인은 불가(팀 해체 이용)
export async function kickScoreMember(tournamentId, user, isManager, b) {
  const { data: m } = await db().from('tournament_team_members').select('*').eq('id', b.memberId).maybeSingle();
  if (!m) throw new Error('멤버를 찾을 수 없어요');
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', m.team_id).maybeSingle();
  if (!team || team.tournament_id !== tournamentId) throw new Error('팀을 찾을 수 없어요');
  if (!isManager && team.captain_user_id !== user.id) throw new Error('방장만 내보낼 수 있어요');
  if (team.captain_user_id && m.user_id === team.captain_user_id) throw new Error('방장은 내보낼 수 없어요 (팀 해체를 이용하세요)');
  await db().from('tournament_team_members').delete().eq('id', m.id);
  if (m.pool_id && m.join_status !== 'requested') await db().from('tournament_pool').update({ sold_to: null }).eq('id', m.pool_id);
  return getTournament(tournamentId);
}

// 팀 확정 (5라인·상한 통과 시 status=approved → 대진 대상)
export async function submitScoreTeamReady(tournamentId, user, isManager, b) {
  const { cap } = await scoreCtx(tournamentId);
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', b.teamId).maybeSingle();
  if (!team || team.tournament_id !== tournamentId) throw new Error('팀을 찾을 수 없어요');
  if (!isManager && team.captain_user_id !== user.id) throw new Error('방장만 확정할 수 있어요');
  const approved = (await teamMembersRaw(team.id)).filter((x) => x.join_status !== 'requested');
  if (approved.length !== 5 || new Set(approved.map((x) => x.role)).size !== 5) throw new Error('5개 라인을 모두 채워야 확정할 수 있어요');
  if (teamTotalPts(approved) > cap) throw new Error(`합계가 상한 ${cap}점을 초과해요`);
  await db().from('tournament_teams').update({ status: 'approved' }).eq('id', team.id);
  await db().from('tournament_team_members').delete().eq('team_id', team.id).eq('join_status', 'requested'); // 남은 대기 신청 정리
  return getTournament(tournamentId);
}

// 팀 해체 (방장 또는 운영자) — 멤버 풀 복귀
export async function disbandScoreTeam(tournamentId, user, isManager, b) {
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', b.teamId).maybeSingle();
  if (!team || team.tournament_id !== tournamentId) throw new Error('팀을 찾을 수 없어요');
  if (!isManager && team.captain_user_id !== user.id) throw new Error('방장만 해체할 수 있어요');
  const mems = await teamMembersRaw(team.id);
  const poolIds = mems.filter((m) => m.pool_id && m.join_status !== 'requested').map((m) => m.pool_id);
  if (poolIds.length) await db().from('tournament_pool').update({ sold_to: null }).in('id', poolIds);
  await db().from('tournament_team_members').delete().eq('team_id', team.id);
  await db().from('tournament_teams').delete().eq('id', team.id);
  return getTournament(tournamentId);
}

export async function removePoolPlayer(poolId) {
  const { data: p } = await db().from('tournament_pool').select('sold_to').eq('id', poolId).maybeSingle();
  if (p?.sold_to) throw new Error('이미 낙찰된 선수예요. 먼저 낙찰을 취소하세요');
  const { error } = await db().from('tournament_pool').delete().eq('id', poolId);
  if (error) throw error;
}

// 낙찰: 선수 → 팀 배정, 예산 차감, 로스터(members) 추가. 원자적 검증.
export async function sellPlayer(tournamentId, b) {
  const price = Math.round(Number(b.price));
  if (!Number.isFinite(price) || price < 0) throw new Error('낙찰가가 올바르지 않아요');
  const { data: p } = await db().from('tournament_pool').select('*').eq('id', b.poolId).maybeSingle();
  if (!p) throw new Error('선수를 찾을 수 없어요');
  if (p.sold_to) throw new Error('이미 낙찰된 선수예요');
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', b.teamId).maybeSingle();
  if (!team || team.tournament_id !== tournamentId) throw new Error('팀을 찾을 수 없어요');
  if ((team.budget ?? 0) < price) throw new Error(`예산 부족 (남은 ${team.budget ?? 0} < ${price})`);
  const { data: mem, error: me } = await db().from('tournament_team_members')
    .insert({ team_id: team.id, game_name: p.game_name, tag_line: p.tag_line, tier: p.tier, role: p.role }).select().single();
  if (me) throw me;
  const { error: pe } = await db().from('tournament_pool').update({ sold_to: team.id, price }).eq('id', p.id);
  if (pe) { await db().from('tournament_team_members').delete().eq('id', mem.id); throw pe; } // 롤백
  await db().from('tournament_teams').update({ budget: (team.budget ?? 0) - price }).eq('id', team.id);
  return getTournament(tournamentId);
}

// ── 실시간 경매 (팀장 지명 → 입찰 → 낙찰) ──

async function upsertAuction(tournamentId, patch) {
  const row = { tournament_id: tournamentId, updated_at: new Date().toISOString(), ...patch };
  let { error } = await db().from('tournament_auction').upsert(row, { onConflict: 'tournament_id' });
  if (error && /extends/i.test(error.message || '')) { delete row.extends; ({ error } = await db().from('tournament_auction').upsert(row, { onConflict: 'tournament_id' })); } // 연장카운트 컬럼 미생성 폴백
  if (error && /bid_deadline/i.test(error.message || '')) { delete row.bid_deadline; ({ error } = await db().from('tournament_auction').upsert(row, { onConflict: 'tournament_id' })); } // 타이머 컬럼 미생성 폴백
  if (error) { if (/tournament_auction|does not exist/i.test(error.message || '')) throw new Error('실시간 경매 마이그레이션(tournament-auction-live-schema.sql)을 먼저 실행하세요'); throw error; }
}

// 신청자 중 랜덤 numTeams명을 팀장으로 지명 → 팀장 팀 생성(예산·본인 로스터 편입).
export async function drawCaptains(tournamentId, numTeams) {
  const n = Math.max(2, Math.min(Number(numTeams) || 2, 16));
  const { data: t } = await db().from('tournaments').select('status, settings').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  if (t.status !== 'recruiting') throw new Error('모집 중일 때만 가능해요');
  const budget = normalizeSettings(t.settings).auction.budget;
  const { data: pool } = await db().from('tournament_pool').select('*').eq('tournament_id', tournamentId);
  const avail = (pool || []).filter((p) => !p.sold_to);
  if (avail.length < n) throw new Error(`팀장 ${n}명을 뽑기엔 신청자가 부족해요 (${avail.length}명)`);
  const arr = avail.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  for (const c of arr.slice(0, n)) {
    const { data: team, error } = await db().from('tournament_teams')
      .insert({ tournament_id: tournamentId, name: `${c.game_name} 팀`, is_captain_team: true, budget, status: 'approved' }).select().single();
    if (error) { if (/budget|is_captain|captain_user/i.test(error.message || '')) throw new Error('실시간 경매 마이그레이션(tournament-auction-live-schema.sql)을 먼저 실행하세요'); throw error; }
    await db().from('tournament_team_members').insert({ team_id: team.id, game_name: c.game_name, tag_line: c.tag_line, tier: c.tier, role: c.role });
    await db().from('tournament_pool').update({ sold_to: team.id, price: 0 }).eq('id', c.id); // 팀장 = 자기 팀
  }
  await upsertAuction(tournamentId, { status: 'idle', current_pool_id: null, current_bid: 0, current_bidder: null });
  return getTournament(tournamentId);
}

// 신청자 1명을 팀장으로 승격 → 팀장 팀 생성(예산·본인 편입).
export async function makeCaptain(tournamentId, poolId) {
  const { data: t } = await db().from('tournaments').select('status, settings').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  if (t.status !== 'recruiting') throw new Error('모집 중일 때만 가능해요');
  const budget = normalizeSettings(t.settings).auction.budget;
  const { data: p } = await db().from('tournament_pool').select('*').eq('id', poolId).maybeSingle();
  if (!p || p.sold_to) throw new Error('이미 배정된 선수예요');
  const { data: team, error } = await db().from('tournament_teams')
    .insert({ tournament_id: tournamentId, name: `${p.game_name} 팀`, is_captain_team: true, budget, status: 'approved', captain_user_id: p.user_id ?? null }).select().single();
  if (error) { if (/budget|is_captain|captain_user/i.test(error.message || '')) throw new Error('실시간 경매 마이그레이션(tournament-auction-live-schema.sql)을 먼저 실행하세요'); throw error; }
  await db().from('tournament_team_members').insert({ team_id: team.id, game_name: p.game_name, tag_line: p.tag_line, tier: p.tier, role: p.role });
  await db().from('tournament_pool').update({ sold_to: team.id, price: 0 }).eq('id', p.id);
  const { data: exist } = await db().from('tournament_auction').select('tournament_id').eq('tournament_id', tournamentId).maybeSingle();
  if (!exist) await upsertAuction(tournamentId, { status: 'idle', current_pool_id: null, current_bid: 0, current_bidder: null });
  return getTournament(tournamentId);
}

// 팀장 해제 (낙찰받은 선수 없을 때만) → 팀장을 신청자 풀로 복귀.
export async function removeCaptainTeam(tournamentId, teamId) {
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', teamId).maybeSingle();
  if (!team || team.tournament_id !== tournamentId || !team.is_captain_team) throw new Error('팀장 팀이 아니에요');
  const { data: soldPs } = await db().from('tournament_pool').select('id, price').eq('sold_to', teamId);
  if ((soldPs || []).some((p) => (p.price || 0) > 0)) throw new Error('이미 낙찰받은 선수가 있어 해제할 수 없어요 (먼저 낙찰 취소)');
  await db().from('tournament_pool').update({ sold_to: null, price: null }).eq('sold_to', teamId); // 팀장 본인 풀 복귀
  await db().from('tournament_team_members').delete().eq('team_id', teamId);
  await db().from('tournament_teams').delete().eq('id', teamId);
  return getTournament(tournamentId);
}

export async function assignCaptainUser(tournamentId, teamId, userId) {
  const { error } = await db().from('tournament_teams').update({ captain_user_id: userId || null }).eq('id', teamId).eq('tournament_id', tournamentId);
  if (error) throw error;
  return getTournament(tournamentId);
}

// 다음 선수 지명 (poolId 지정 없으면 랜덤). 남은 선수 없으면 종료.
export async function nominateNext(tournamentId, poolId = null) {
  const { data: t } = await db().from('tournaments').select('settings').eq('id', tournamentId).maybeSingle();
  const bidSeconds = normalizeSettings(t?.settings).auction.bidSeconds;
  const { data: pool } = await db().from('tournament_pool').select('*').eq('tournament_id', tournamentId);
  const avail = (pool || []).filter((p) => !p.sold_to);
  if (!avail.length) { await upsertAuction(tournamentId, { status: 'done', current_pool_id: null, current_bid: 0, current_bidder: null, bid_deadline: null }); return getTournament(tournamentId); }
  let pick = poolId ? avail.find((p) => p.id === poolId) : null;
  if (!pick) { // 대기(미유찰) 우선, 없으면 유찰 선수 재경매
    const waiting = avail.filter((p) => !p.passed);
    const src = waiting.length ? waiting : avail;
    pick = src[Math.floor(Math.random() * src.length)];
  }
  await db().from('tournament_pool').update({ passed: false }).eq('id', pick.id); // 재경매 시 유찰 해제(컬럼 없으면 무시)
  const deadline = new Date(Date.now() + bidSeconds * 1000).toISOString();
  await upsertAuction(tournamentId, { status: 'bidding', current_pool_id: pick.id, current_bid: 0, current_bidder: null, bid_deadline: deadline, extends: 0 });
  return getTournament(tournamentId);
}

// 입찰 (금액 수동 입력). 그 팀 팀장만(팀장 유저 미지정이면 관리자 대리 허용).
export async function placeBid(tournamentId, teamId, user, amount, isAdmin) {
  const { data: a } = await db().from('tournament_auction').select('*').eq('tournament_id', tournamentId).maybeSingle();
  if (!a || a.status !== 'bidding' || !a.current_pool_id) throw new Error('입찰 가능한 경매가 없어요');
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', teamId).maybeSingle();
  if (!team || team.tournament_id !== tournamentId || !team.is_captain_team) throw new Error('팀장 팀이 아니에요');
  if (team.captain_user_id) { if (team.captain_user_id !== user?.id) throw new Error('본인 팀만 입찰할 수 있어요'); }
  else if (!isAdmin) throw new Error('팀장만 입찰할 수 있어요'); // 팀장 유저 미지정 → 관리자만 대리
  if (a.current_bidder === teamId) throw new Error('이미 최고 입찰 중이에요');
  const bid = Math.round(Number(amount));
  const cur = a.current_bid || 0;
  if (!Number.isFinite(bid) || bid < 1) throw new Error('입찰가를 입력하세요');
  if (bid <= cur) throw new Error(`현재가 ${cur}p보다 높게 입찰하세요`);
  if ((team.budget ?? 0) < bid) throw new Error(`예산 부족 (남은 ${team.budget ?? 0} < ${bid})`);
  const { data: tt } = await db().from('tournaments').select('settings').eq('id', tournamentId).maybeSingle();
  const au = normalizeSettings(tt?.settings).auction;
  // 연장 상한 도달(횟수) 또는 일정 금액 초과 시 타이머 리셋 안 함 → 하드 마감/스나이핑
  const curExt = a.extends || 0;
  const shouldReset = (au.bidMaxExtends === 0 || curExt < au.bidMaxExtends) && (au.bidNoResetOver === 0 || bid < au.bidNoResetOver);
  const patch = { status: 'bidding', current_pool_id: a.current_pool_id, current_bid: bid, current_bidder: teamId, increment: a.increment || 5 };
  if (shouldReset) { patch.bid_deadline = new Date(Date.now() + au.bidSeconds * 1000).toISOString(); patch.extends = curExt + 1; }
  await upsertAuction(tournamentId, patch);
  return getTournament(tournamentId);
}

// 낙찰: 최고 입찰 팀에 배정 + 예산 차감 + 풀 소비 → idle.
export async function sellCurrent(tournamentId) {
  const { data: a } = await db().from('tournament_auction').select('*').eq('tournament_id', tournamentId).maybeSingle();
  if (!a || !a.current_pool_id) throw new Error('지명된 선수가 없어요');
  if (!a.current_bidder) throw new Error('입찰자가 없어요 (유찰하려면 유찰 버튼)');
  const { data: p } = await db().from('tournament_pool').select('*').eq('id', a.current_pool_id).maybeSingle();
  if (!p || p.sold_to) throw new Error('이미 처리된 선수예요');
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', a.current_bidder).maybeSingle();
  const price = a.current_bid || 0;
  await db().from('tournament_team_members').insert({ team_id: team.id, game_name: p.game_name, tag_line: p.tag_line, tier: p.tier, role: p.role });
  await db().from('tournament_pool').update({ sold_to: team.id, price }).eq('id', p.id);
  await db().from('tournament_teams').update({ budget: (team.budget ?? 0) - price }).eq('id', team.id);
  await upsertAuction(tournamentId, { status: 'idle', current_pool_id: null, current_bid: 0, current_bidder: null, bid_deadline: null });
  return getTournament(tournamentId);
}

export async function passCurrent(tournamentId) { // 유찰 → 명단에 남김
  const { data: a } = await db().from('tournament_auction').select('current_pool_id').eq('tournament_id', tournamentId).maybeSingle();
  if (a?.current_pool_id) await db().from('tournament_pool').update({ passed: true }).eq('id', a.current_pool_id); // passed 컬럼 없으면 무시
  await upsertAuction(tournamentId, { status: 'idle', current_pool_id: null, current_bid: 0, current_bidder: null, bid_deadline: null });
  return getTournament(tournamentId);
}

// 잔여(유찰 포함) 선수를 잔여 예산 많은 팀 순 라운드로빈으로 배정 → 종료.
export async function distributeLeftover(tournamentId) {
  const { data: capts } = await db().from('tournament_teams').select('*').eq('tournament_id', tournamentId).eq('is_captain_team', true);
  if (!capts || !capts.length) throw new Error('팀장이 없어요');
  const { data: pool } = await db().from('tournament_pool').select('*').eq('tournament_id', tournamentId);
  const { data: mems } = await db().from('tournament_team_members').select('team_id').in('team_id', capts.map((t) => t.id));
  const count = {}; capts.forEach((t) => { count[t.id] = 0; });
  (mems || []).forEach((m) => { if (count[m.team_id] != null) count[m.team_id] += 1; });
  const TARGET = 5;
  const leftover = (pool || []).filter((p) => !p.sold_to)
    .sort((x, y) => (tierRank(x.tier) ?? 999) - (tierRank(y.tier) ?? 999)); // 강한 선수 먼저
  let changed = true;
  while (leftover.length && changed) {
    changed = false;
    const order = capts.filter((t) => count[t.id] < TARGET).sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0));
    for (const team of order) {
      if (!leftover.length) break;
      const p = leftover.shift();
      await db().from('tournament_team_members').insert({ team_id: team.id, game_name: p.game_name, tag_line: p.tag_line, tier: p.tier, role: p.role });
      await db().from('tournament_pool').update({ sold_to: team.id, price: 0, passed: false }).eq('id', p.id);
      count[team.id] += 1;
      changed = true;
    }
  }
  await upsertAuction(tournamentId, { status: 'done', current_pool_id: null, current_bid: 0, current_bidder: null, bid_deadline: null });
  return getTournament(tournamentId);
}
export async function endAuction(tournamentId) {
  await upsertAuction(tournamentId, { status: 'done', current_pool_id: null, current_bid: 0, current_bidder: null, bid_deadline: null });
  return getTournament(tournamentId);
}

// 🔄 경매 전체 초기화 (테스트용) — 팀·낙찰·대진 삭제, 신청자 풀 복원, 예산 리셋, 모집중.
export async function resetAuction(tournamentId) {
  const { data: teams } = await db().from('tournament_teams').select('id').eq('tournament_id', tournamentId);
  const ids = (teams || []).map((t) => t.id);
  if (ids.length) {
    await db().from('tournament_team_members').delete().in('team_id', ids);
    await db().from('tournament_teams').delete().in('id', ids);
  }
  await db().from('tournament_matches').delete().eq('tournament_id', tournamentId);
  let { error } = await db().from('tournament_pool').update({ sold_to: null, price: null, passed: false }).eq('tournament_id', tournamentId);
  if (error && /passed/i.test(error.message || '')) await db().from('tournament_pool').update({ sold_to: null, price: null }).eq('tournament_id', tournamentId);
  await db().from('tournaments').update({ status: 'recruiting' }).eq('id', tournamentId);
  await upsertAuction(tournamentId, { status: 'idle', current_pool_id: null, current_bid: 0, current_bidder: null, bid_deadline: null });
  return getTournament(tournamentId);
}

// 낙찰 취소: 예산 환급, 로스터에서 제거, 풀로 복귀.
export async function undoSale(tournamentId, poolId) {
  const { data: p } = await db().from('tournament_pool').select('*').eq('id', poolId).maybeSingle();
  if (!p || !p.sold_to) throw new Error('취소할 낙찰이 없어요');
  const { data: team } = await db().from('tournament_teams').select('*').eq('id', p.sold_to).maybeSingle();
  // 로스터에서 이 선수 1건 제거 (동일 닉 중 하나)
  const { data: mem } = await db().from('tournament_team_members').select('id').eq('team_id', p.sold_to).eq('game_name', p.game_name).limit(1);
  if (mem && mem[0]) await db().from('tournament_team_members').delete().eq('id', mem[0].id);
  if (team) await db().from('tournament_teams').update({ budget: (team.budget ?? 0) + (p.price || 0) }).eq('id', team.id);
  await db().from('tournament_pool').update({ sold_to: null, price: null }).eq('id', poolId);
  return getTournament(tournamentId);
}

export async function setTeamStatus(teamId, status) {
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new Error('잘못된 상태');
  const { error } = await db().from('tournament_teams').update({ status }).eq('id', teamId);
  if (error) throw error;
}

// ── 🎮 멸망전 경기 기록 (스크림/시합) — 내전과 분리, 팀 로스터 자동 귀속 ──
const MIGRATE_GAMES = '멸망전 경기 마이그레이션(tournament-games-schema.sql)을 먼저 실행하세요';
export async function saveTournamentGame(tournamentId, b) {
  const parts = Array.isArray(b.participants) ? b.participants : [];
  if (parts.length < 2) throw new Error('참가자 정보가 없어요');
  const row = {
    tournament_id: tournamentId, kind: b.kind === 'scrim' ? 'scrim' : 'match',
    uploader_team_id: b.uploader_team_id || null, uploader_user_id: b.uploader_user_id || null,
    winner: b.winner === 'B' ? 'B' : 'A', duration_sec: Number(b.durationSec) || 0,
    objectives: b.objectives || null, participants: parts, source: b.source || 'replay',
    played_at: b.played_at || new Date().toISOString(),
  };
  const { error } = await db().from('tournament_games').insert(row);
  if (error) { if (/tournament_games|does not exist/i.test(error.message || '')) throw new Error(MIGRATE_GAMES); throw error; }
  return getTournament(tournamentId);
}
export async function deleteTournamentGame(tournamentId, gameId) {
  const { error } = await db().from('tournament_games').delete().eq('id', gameId).eq('tournament_id', tournamentId);
  if (error) throw error;
  return getTournament(tournamentId);
}

export async function deleteTeam(teamId) {
  const { error } = await db().from('tournament_teams').delete().eq('id', teamId);
  if (error) throw error;
}

// 대진 생성: 승인팀 시드 배정(설정) → 포맷별 매치 insert → status=running
export async function generateBracket(tournamentId) {
  const { data: tRow } = await db().from('tournaments').select('settings').eq('id', tournamentId).maybeSingle();
  const settings = normalizeSettings(tRow?.settings);
  const { data: teams } = await db().from('tournament_teams').select('id, created_at').eq('tournament_id', tournamentId).eq('status', 'approved').order('created_at');
  if (!teams || teams.length < 2) throw new Error('승인된 팀이 2팀 이상이어야 대진을 짤 수 있어요');
  // 티어 시드용 팀 전력 계산(멤버 티어 평균). order/random은 불필요.
  let strengthById = {};
  if (settings.seeding === 'tier') {
    const { data: mem } = await db().from('tournament_team_members').select('team_id, tier').in('team_id', teams.map((t) => t.id));
    const byTeam = {};
    (mem || []).forEach((m) => { (byTeam[m.team_id] = byTeam[m.team_id] || []).push(m.tier); });
    strengthById = Object.fromEntries(teams.map((t) => [t.id, teamStrength(byTeam[t.id])]));
  }
  const seeded = seedTeams(teams.map((t) => ({ id: t.id, created_at: t.created_at, strength: strengthById[t.id] })), settings.seeding);
  await db().from('tournament_teams').update({ seed: null }).eq('tournament_id', tournamentId); // 초기화
  for (const s of seeded) await db().from('tournament_teams').update({ seed: s.seed }).eq('id', s.id);
  await db().from('tournament_matches').delete().eq('tournament_id', tournamentId); // 재생성 대비
  let matches;
  if (settings.format === 'group_stage') {
    if (seeded.length < settings.groups.count * 2) throw new Error(`그룹 ${settings.groups.count}개엔 팀이 부족해요 (조당 2팀 이상 필요)`);
    const { matches: gm } = generateGroups(seeded, settings.groups.count);
    matches = gm.map((m) => ({ tournament_id: tournamentId, ...m }));
  } else if (settings.format === 'double_elim') {
    matches = generateDoubleElim(seeded).map((m) => ({ tournament_id: tournamentId, ...m })); // n=2^k 검증은 내부에서
  } else {
    matches = generateSingleElim(seeded).map((m) => ({ tournament_id: tournamentId, ...m }));
    if (settings.thirdPlace && seeded.length >= 4) matches.push({ tournament_id: tournamentId, bracket: 'T', round: 1, pos: 0, team_a: null, team_b: null, winner: null });
  }
  const { error } = await db().from('tournament_matches').insert(matches);
  if (error) {
    if (/bracket|grp/i.test(error.message || '')) throw new Error('그룹/더블엘리를 쓰려면 마이그레이션(tournament-format-schema.sql)을 먼저 실행하세요');
    throw error;
  }
  await db().from('tournaments').update({ status: 'running' }).eq('id', tournamentId);
  return getTournament(tournamentId);
}

// 🔄 대진 취소 (진행중 → 모집중). 대진(경기)만 삭제, 팀·신청자는 유지 → 재편성 가능. (테스트/정정용)
export async function cancelBracket(tournamentId) {
  const { data: t } = await db().from('tournaments').select('id').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  await db().from('tournament_matches').delete().eq('tournament_id', tournamentId);
  await db().from('tournament_teams').update({ seed: null }).eq('tournament_id', tournamentId);
  await db().from('tournaments').update({ status: 'recruiting' }).eq('id', tournamentId);
  return getTournament(tournamentId);
}

// 조별 경기 완료 시 본선(K) 생성 — 조별 상위 advance팀을 시드로 싱글엘리.
async function buildKnockoutFromGroups(tournamentId, all) {
  if (all.some((x) => x.bracket === 'K')) return; // 이미 생성됨
  const { data: tRow } = await db().from('tournaments').select('settings').eq('id', tournamentId).maybeSingle();
  const advance = normalizeSettings(tRow?.settings).groups.advance;
  const gmap = {};
  all.filter((x) => x.bracket === 'G').forEach((x) => {
    (gmap[x.grp] = gmap[x.grp] || new Set());
    if (x.team_a) gmap[x.grp].add(x.team_a); if (x.team_b) gmap[x.grp].add(x.team_b);
  });
  const groups = Object.keys(gmap).sort((a, c) => a - c).map((gi) => [...gmap[gi]]);
  const seeds = knockoutSeeds(groupStandings(all, groups), advance);
  if (seeds.length < 2) return;
  const kMatches = generateSingleElim(seeds).map((m) => ({ tournament_id: tournamentId, bracket: 'K', ...m }));
  if (normalizeSettings(tRow?.settings).thirdPlace && seeds.length >= 4) kMatches.push({ tournament_id: tournamentId, bracket: 'T', round: 1, pos: 0, team_a: null, team_b: null, winner: null });
  await db().from('tournament_matches').insert(kMatches);
}

// 경기 일정(날짜/시간) 설정·해제
export async function setMatchSchedule(tournamentId, matchId, scheduledAt) {
  const { error } = await db().from('tournament_matches').update({ scheduled_at: scheduledAt || null }).eq('id', matchId).eq('tournament_id', tournamentId);
  if (error) { if (/scheduled_at/i.test(error.message || '')) throw new Error('일정 마이그레이션(tournament-schedule-schema.sql)을 먼저 실행하세요'); throw error; }
  return getTournament(tournamentId);
}

// 경기 결과 입력: 승자 저장 + 진출/본선생성. 최종 결승이면 대회 종료.
export async function reportMatch(matchId, b) {
  const { data: m } = await db().from('tournament_matches').select('*').eq('id', matchId).maybeSingle();
  if (!m) throw new Error('경기를 찾을 수 없어요');
  const winner = b.winner;
  if (winner !== m.team_a && winner !== m.team_b) throw new Error('승자가 이 경기의 팀이 아니에요');
  await db().from('tournament_matches').update({ winner, score_a: b.score_a ?? null, score_b: b.score_b ?? null }).eq('id', matchId);
  const { data: all } = await db().from('tournament_matches').select('*').eq('tournament_id', m.tournament_id);
  const cur = all.map((x) => (x.id === matchId ? { ...x, winner } : x)); // 방금 결과 반영본
  if (m.bracket === 'T') {
    // 3·4위전: 승자만 기록, 진출/상태변경 없음
  } else if (m.bracket === 'G') {
    // 조별: 모든 조 경기 끝나면 본선 자동 생성. 아니면 대기.
    if (groupsComplete(cur)) await buildKnockoutFromGroups(m.tournament_id, cur);
  } else if (m.bracket === 'W' || m.bracket === 'L' || m.bracket === 'GF') {
    // 더블 엘리: 승자/패자 라우팅 (승자조 패자는 패자조로 강등)
    const { k, lbRounds } = deParamsFromMatches(cur);
    const loser = winner === m.team_a ? m.team_b : m.team_a;
    const place = async (route, team) => {
      if (!route || !team) return;
      const nm = cur.find((x) => x.bracket === route.bracket && x.round === route.round && x.pos === route.pos);
      if (nm) await db().from('tournament_matches').update({ [`team_${route.slot}`]: team }).eq('id', nm.id);
    };
    if (m.bracket === 'GF') {
      await db().from('tournaments').update({ status: 'done' }).eq('id', m.tournament_id); // 최종결승 = 종료
    } else if (m.bracket === 'W') {
      await place(wbWinTo(m.round, m.pos, k), winner);
      await place(wbLoseTo(m.round, m.pos, k), loser);
    } else { // L
      await place(lbWinTo(m.round, m.pos, k, lbRounds), winner);
    }
  } else {
    // 싱글엘리(null) / 본선(K): 같은 브라켓 내에서 진출
    const seg = cur.filter((x) => (x.bracket || null) === (m.bracket || null));
    const totalRounds = Math.max(...seg.map((x) => x.round));
    const nx = nextSlot(m.round, m.pos, totalRounds);
    if (nx) {
      const nextM = seg.find((x) => x.round === nx.round && x.pos === nx.pos);
      if (nextM) await db().from('tournament_matches').update({ [`team_${nx.slot}`]: winner }).eq('id', nextM.id);
    } else {
      await db().from('tournaments').update({ status: 'done' }).eq('id', m.tournament_id); // 최종 결승 = 종료
    }
    // 3·4위전: 준결승(결승 직전 라운드) 패자를 3위전으로 (pos 0→a, 1→b)
    if (m.round === totalRounds - 1) {
      const tMatch = cur.find((x) => x.bracket === 'T');
      if (tMatch) { const loser = winner === m.team_a ? m.team_b : m.team_a; await db().from('tournament_matches').update({ [`team_${m.pos === 0 ? 'a' : 'b'}`]: loser }).eq('id', tMatch.id); }
    }
  }
  return getTournament(m.tournament_id);
}
