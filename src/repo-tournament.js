// 멸망전(대회) DB 접근 — 내전 repo와 분리. 서버 전용(service_role).
import { db } from './supabase.js';
import { generateSingleElim, nextSlot } from './bracket.js';

export async function listTournaments(gid) {
  const { data, error } = await db().from('tournaments').select('*').eq('group_id', gid).order('created_at', { ascending: false });
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

export async function createTournament(gid, b) {
  const row = {
    group_id: gid, name: (b.name || '').trim() || '새 대회',
    max_teams: [4, 8, 16, 32].includes(Number(b.max_teams)) ? Number(b.max_teams) : 8,
    team_size: Number(b.team_size) || 5, tier_cap: b.tier_cap || null,
    starts_at: b.starts_at || null,
  };
  const { data, error } = await db().from('tournaments').insert(row).select().single();
  if (error) throw error;
  return data;
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
  const { data: t } = await db().from('tournaments').select('status, max_teams').eq('id', tournamentId).maybeSingle();
  if (!t) throw new Error('대회를 찾을 수 없어요');
  if (t.status !== 'recruiting') throw new Error('신청이 마감된 대회예요');
  const name = (b.name || '').trim();
  if (!name) throw new Error('팀 이름을 입력하세요');
  const members = (b.members || []).filter((m) => (m.game_name || '').trim());
  if (!members.length) throw new Error('로스터를 1명 이상 입력하세요');
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

// 대진 생성: 승인팀 시드 배정 → 싱글엘리 매치 insert → status=running
export async function generateBracket(tournamentId) {
  const { data: teams } = await db().from('tournament_teams').select('id, created_at').eq('tournament_id', tournamentId).eq('status', 'approved').order('created_at');
  if (!teams || teams.length < 2) throw new Error('승인된 팀이 2팀 이상이어야 대진을 짤 수 있어요');
  // 시드 = 승인 순서(1..n). (추후 티어 시드로 교체 가능)
  const seeded = teams.map((t, i) => ({ id: t.id, seed: i + 1 }));
  await db().from('tournament_teams').update({ seed: null }).eq('tournament_id', tournamentId); // 초기화
  for (const s of seeded) await db().from('tournament_teams').update({ seed: s.seed }).eq('id', s.id);
  await db().from('tournament_matches').delete().eq('tournament_id', tournamentId); // 재생성 대비
  const matches = generateSingleElim(seeded).map((m) => ({ tournament_id: tournamentId, ...m }));
  const { error } = await db().from('tournament_matches').insert(matches);
  if (error) throw error;
  await db().from('tournaments').update({ status: 'running' }).eq('id', tournamentId);
  return getTournament(tournamentId);
}

// 경기 결과 입력: 승자 저장 + 다음 라운드로 진출. 결승이면 대회 종료.
export async function reportMatch(matchId, b) {
  const { data: m } = await db().from('tournament_matches').select('*').eq('id', matchId).maybeSingle();
  if (!m) throw new Error('경기를 찾을 수 없어요');
  const winner = b.winner;
  if (winner !== m.team_a && winner !== m.team_b) throw new Error('승자가 이 경기의 팀이 아니에요');
  await db().from('tournament_matches').update({ winner, score_a: b.score_a ?? null, score_b: b.score_b ?? null }).eq('id', matchId);
  const { data: all } = await db().from('tournament_matches').select('round, pos, id').eq('tournament_id', m.tournament_id);
  const totalRounds = Math.max(...all.map((x) => x.round));
  const nx = nextSlot(m.round, m.pos, totalRounds);
  if (nx) {
    const nextM = all.find((x) => x.round === nx.round && x.pos === nx.pos);
    if (nextM) await db().from('tournament_matches').update({ [`team_${nx.slot}`]: winner }).eq('id', nextM.id);
  } else {
    await db().from('tournaments').update({ status: 'done' }).eq('id', m.tournament_id); // 결승 = 종료
  }
  return getTournament(m.tournament_id);
}
