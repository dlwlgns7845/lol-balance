// 멸망전(대회) DB 접근 — 내전 repo와 분리. 서버 전용(service_role).
import { db } from './supabase.js';
import { generateSingleElim, nextSlot, generateGroups, groupStandings, knockoutSeeds, groupsComplete } from './bracket.js';
import { normalizeSettings, validateEligibility, seedTeams, teamStrength } from './tournament-settings.js';

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
  return { tournament, teams: teamsWithMembers, matches: matches || [] };
}

export async function applyTeam(tournamentId, b) {
  const { data: t } = await db().from('tournaments').select('*').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  if (t.status !== 'recruiting') throw new Error('신청이 마감된 대회예요');
  const name = (b.name || '').trim();
  if (!name) throw new Error('팀 이름을 입력하세요');
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

export async function setTeamStatus(teamId, status) {
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new Error('잘못된 상태');
  const { error } = await db().from('tournament_teams').update({ status }).eq('id', teamId);
  if (error) throw error;
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
  } else {
    matches = generateSingleElim(seeded).map((m) => ({ tournament_id: tournamentId, ...m }));
  }
  const { error } = await db().from('tournament_matches').insert(matches);
  if (error) {
    if (/bracket|grp/i.test(error.message || '')) throw new Error('그룹 스테이지를 쓰려면 마이그레이션(tournament-format-schema.sql)을 먼저 실행하세요');
    throw error;
  }
  await db().from('tournaments').update({ status: 'running' }).eq('id', tournamentId);
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
  await db().from('tournament_matches').insert(kMatches);
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
  if (m.bracket === 'G') {
    // 조별: 모든 조 경기 끝나면 본선 자동 생성. 아니면 대기.
    if (groupsComplete(cur)) await buildKnockoutFromGroups(m.tournament_id, cur);
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
  }
  return getTournament(m.tournament_id);
}
