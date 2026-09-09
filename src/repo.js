// Supabase 데이터 접근 (서버 전용). groups / persons / accounts CRUD.
import { db } from './supabase.js';
import { TIER_ORDER } from './table.js';
import { fetchTierEstimate } from './opgg.js';

// 티어 순위(작을수록 높음). base_tier = 계정들 중 가장 높은 티어로.
const tierRank = (t) => { const i = TIER_ORDER.indexOf(t); return i === -1 ? 9999 : i; };
// 기존 base_tier + 계정 티어들 중 가장 높은 것으로 (더 높은 쪽 채택, 낮추지 않음)
export async function recomputeBaseTier(personId) {
  if (!personId) return;
  const { data: person } = await db().from('persons').select('base_tier, tier_locked').eq('id', personId).maybeSingle();
  if (person?.tier_locked) return; // 운영자 수동 고정 → base_tier 안 건드림 (자동 갱신·계정변경 무시)
  const { data: accts } = await db().from('accounts').select('opgg_tier').eq('person_id', personId);
  const tiers = [person?.base_tier, ...(accts || []).map((x) => x.opgg_tier)].filter(Boolean);
  if (!tiers.length) return;
  const best = tiers.reduce((b, t) => (tierRank(t) < tierRank(b) ? t : b), tiers[0]);
  if (best !== person?.base_tier) await db().from('persons').update({ base_tier: best }).eq('id', personId);
}

// ── 방(그룹) ──
export async function getGroupByCode(code) {
  const { data, error } = await db().from('groups').select('*').eq('code', code).maybeSingle();
  if (error) throw error;
  return data; // 없으면 null
}

export async function createGroup(code, name, owner = null) {
  const existing = await getGroupByCode(code);
  if (existing) throw new Error('이미 존재하는 코드입니다 — 그 코드로 "들어가기" 하세요');
  const { data, error } = await db().from('groups')
    .insert({ code, name: name || code, owner_id: owner?.id || null }).select().single();
  if (error) throw error;
  // 만든 사람 = 방장
  if (owner?.id) {
    await db().from('room_members').upsert({
      group_id: data.id, user_id: owner.id, email: owner.email || null,
      name: owner.name || null, role: 'owner',
    }, { onConflict: 'group_id,user_id' });
  }
  return data;
}

export async function getGroupById(id) {
  const { data, error } = await db().from('groups').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// ── 디스코드 서버(guild) ↔ 방 매핑 (봇 멀티테넌트) ── 승인 방식: 요청(pending) → 방장이 사이트에서 승인(approved).
// getGuildRoom 은 승인된 것만 반환 → 코드 알아도 승인 전엔 권한 없음(테러 방지).
export async function getGuildRoom(guildId) {
  if (!guildId) return null;
  try {
    const { data, error } = await db().from('discord_guilds')
      .select('group_id, status').eq('guild_id', guildId).maybeSingle();
    if (error) return null;
    return (data && data.status === 'approved') ? data.group_id : null;
  } catch { return null; }
}
// 이 서버의 연결 상태 (봇이 요청자에게 안내용) — { status, group_id } | null
export async function getGuildLink(guildId) {
  if (!guildId) return null;
  const { data, error } = await db().from('discord_guilds').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) return null;
  return data || null;
}
// 연결 요청 (pending). 같은 서버가 다시 요청하면 갱신.
export async function requestGuildLink(guildId, groupId, requester, guildName, guildIcon) {
  const row = {
    guild_id: guildId, group_id: groupId, status: 'pending',
    linked_by: requester || null, guild_name: guildName || null,
  };
  if (guildIcon !== undefined) row.guild_icon = guildIcon || null;
  const { error } = await db().from('discord_guilds').upsert(row, { onConflict: 'guild_id' });
  // guild_icon 컬럼 미반영(마이그 전)이면 아이콘 없이 재시도 → 연결 자체는 항상 되게
  if (error) {
    delete row.guild_icon;
    const { error: e2 } = await db().from('discord_guilds').upsert(row, { onConflict: 'guild_id' });
    if (e2) throw e2;
  }
}
// 이 방의 브랜딩용 디코 서버 (승인된 것 중 가장 먼저 연결된 것) — { guild_id, guild_name, guild_icon } | null
export async function getRoomGuildBrand(groupId) {
  if (!groupId) return null;
  try {
    const { data, error } = await db().from('discord_guilds')
      .select('guild_id, guild_name, guild_icon').eq('group_id', groupId).eq('status', 'approved')
      .order('created_at', { ascending: true }).limit(1);
    if (error || !data?.length) return null;
    const g = data[0];
    return g.guild_icon ? g : { ...g, guild_icon: null };
  } catch { return null; }
}
// 방의 대기중 요청 목록 (사이트 방장/관리자용)
export async function listPendingLinks(groupId) {
  const { data, error } = await db().from('discord_guilds')
    .select('guild_id, guild_name, linked_by, created_at').eq('group_id', groupId).eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
// 현재 이 방에 승인 연결된 서버들 (여러 서버가 같은 방 공유 가능)
export async function getApprovedGuilds(groupId) {
  const { data, error } = await db().from('discord_guilds')
    .select('guild_id, guild_name, linked_by').eq('group_id', groupId).eq('status', 'approved')
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}
// 승인: 이 서버를 approved 로 (다른 서버는 그대로 — 한 방을 여러 서버가 공유 가능)
// 서버 이름·아이콘 갱신 (승인 시/주기적). 컬럼 없거나 실패해도 조용히 무시.
export async function updateGuildBrand(guildId, name, icon) {
  if (!guildId) return;
  try {
    await db().from('discord_guilds').update({ guild_name: name || null, guild_icon: icon || null }).eq('guild_id', guildId);
  } catch { /* guild_icon 컬럼 미반영 → 무시 */ }
}
export async function approveGuildLink(groupId, guildId) {
  const { error } = await db().from('discord_guilds').update({ status: 'approved' })
    .eq('guild_id', guildId).eq('group_id', groupId);
  if (error) throw error;
}
// 거절/해제: 요청 또는 연결 삭제
export async function removeGuildLink(guildId) {
  const { error } = await db().from('discord_guilds').delete().eq('guild_id', guildId);
  if (error) throw error;
}

// ── 디코봇 관리자 (방별 /기록 권한) ──
const MIGRATE_BOTADMIN = '관리자 마이그레이션(discord-bot-admins-schema.sql)을 먼저 실행하세요';
export async function isBotAdmin(gid, discordId) {
  if (!gid || !discordId) return false;
  try {
    const { data, error } = await db().from('discord_bot_admins').select('discord_id').eq('gid', gid).eq('discord_id', discordId).maybeSingle();
    if (error) return false;
    return !!data;
  } catch { return false; }
}
export async function grantBotAdmin(gid, discordId, name, by) {
  const { error } = await db().from('discord_bot_admins').upsert({ gid, discord_id: discordId, name: name || null, granted_by: by || null }, { onConflict: 'gid,discord_id' });
  if (error) { if (/discord_bot_admins|does not exist/i.test(error.message || '')) throw new Error(MIGRATE_BOTADMIN); throw error; }
}
export async function revokeBotAdmin(gid, discordId) {
  const { error } = await db().from('discord_bot_admins').delete().eq('gid', gid).eq('discord_id', discordId);
  if (error) { if (/discord_bot_admins|does not exist/i.test(error.message || '')) throw new Error(MIGRATE_BOTADMIN); throw error; }
}
export async function listBotAdmins(gid) {
  try {
    const { data, error } = await db().from('discord_bot_admins').select('discord_id, name, created_at').eq('gid', gid).order('created_at');
    if (error) return [];
    return data || [];
  } catch { return []; }
}

// 연동된 사람들의 표시이름(nickname)을 디스코드 '서버 별명'으로 동기화. 사이트 로드시 호출(45초 캐시).
// 봇토큰 필요. 개별 멤버 조회라 privileged intent 불필요. 별명 없으면 global_name/username 폴백.
const _nickSyncedAt = new Map(); // gid → ms
export async function syncGuildNicks(gid) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !gid) return;
  const now = Date.now();
  if (now - (_nickSyncedAt.get(gid) || 0) < 45000) return; // 45초 내 재조회 스킵
  _nickSyncedAt.set(gid, now);
  try {
    const guilds = await getApprovedGuilds(gid);
    const guildIds = (guilds || []).map((g) => g.guild_id).filter(Boolean);
    if (!guildIds.length) return;
    const persons = (await listPersons(gid)).filter((p) => p.discord_id && !String(p.discord_id).startsWith('site:'));
    await Promise.all(persons.map(async (p) => {
      // 방에 승인된 길드가 여러 개일 수 있음 → 멤버가 있는 길드를 찾을 때까지 순회 (첫 길드에 없으면 404)
      for (const guildId of guildIds) {
        try {
          const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${p.discord_id}`, { headers: { Authorization: `Bot ${token}` } });
          if (!r.ok) continue; // 이 길드엔 없음 → 다음 길드
          const mem = await r.json();
          const nick = mem.nick || mem.user?.global_name || mem.user?.username;
          if (nick && nick !== p.nickname) await db().from('persons').update({ nickname: nick }).eq('id', p.id);
          return; // 찾았으면 종료
        } catch { /* 이 길드 조회 실패 → 다음 길드 */ }
      }
    }));
  } catch { /* 길드/토큰 문제면 스킵 → 저장된 이름 사용 */ }
}

// 로그인 유저가 방에 들어오면 멤버로 등록(없을 때만 viewer). 기존 역할은 안 낮춤.
// 내 로그인 흔적(관람자 기록) 삭제 — 다시 로그인/입장하면 정상 재등록됨. 방장/편집자 역할은 유지.
export async function deleteMyTraces(userId) {
  if (!userId) throw new Error('user_id 필요');
  await db().from('room_members').delete().eq('user_id', userId).eq('role', 'viewer');
  await db().from('tournament_members').delete().eq('user_id', userId).eq('role', 'viewer'); // 테이블 없으면 무시
}

export async function registerMembership(groupId, user) {
  if (!groupId || !user?.id) return;
  const { data: cur } = await db().from('room_members')
    .select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle();
  if (cur) {
    // 이름/이메일만 갱신(역할 유지)
    await db().from('room_members').update({ email: user.email || null, name: user.name || null })
      .eq('group_id', groupId).eq('user_id', user.id);
    return;
  }
  await db().from('room_members').insert({
    group_id: groupId, user_id: user.id, email: user.email || null, name: user.name || null, role: 'viewer',
  });
}

// 레거시(주인 없는) 방을 로그인 유저가 방장으로 claim. 이미 주인 있으면 거부.
export async function claimOwnership(groupId, user) {
  const g = await getGroupById(groupId);
  if (!g) throw new Error('없는 방');
  if (g.owner_id) throw new Error('이미 방장이 있는 방이에요');
  await db().from('groups').update({ owner_id: user.id }).eq('id', groupId);
  await db().from('room_members').upsert({
    group_id: groupId, user_id: user.id, email: user.email || null, name: user.name || null, role: 'owner',
  }, { onConflict: 'group_id,user_id' });
  return getGroupById(groupId);
}

export async function listMembers(groupId) {
  const { data, error } = await db().from('room_members')
    .select('user_id, email, name, role, created_at').eq('group_id', groupId).order('created_at');
  if (error) throw error;
  return data || [];
}

// 방장이 멤버 역할 변경 (editor/viewer). owner는 못 바꿈(자기 자신 유지).
export async function setMemberRole(groupId, userId, role) {
  if (!['editor', 'recorder', 'viewer'].includes(role)) throw new Error('role은 editor/recorder/viewer');
  const { data: t } = await db().from('room_members')
    .select('role').eq('group_id', groupId).eq('user_id', userId).maybeSingle();
  if (!t) throw new Error('그 멤버가 없어요');
  if (t.role === 'owner') throw new Error('방장 역할은 바꿀 수 없어요');
  const { error } = await db().from('room_members').update({ role })
    .eq('group_id', groupId).eq('user_id', userId);
  if (error) throw error;
}

// 방장이 멤버를 방에서 내보냄(room_members 행 삭제). 로그아웃해도 남는 흔적 정리용.
// 방장 자신은 못 지움. 기록(사람·경기)은 별개 계층이라 영향 없음.
export async function removeMember(groupId, userId) {
  const { data: t } = await db().from('room_members')
    .select('role').eq('group_id', groupId).eq('user_id', userId).maybeSingle();
  if (!t) throw new Error('그 멤버가 없어요');
  if (t.role === 'owner') throw new Error('방장은 내보낼 수 없어요');
  const { error } = await db().from('room_members').delete()
    .eq('group_id', groupId).eq('user_id', userId);
  if (error) throw error;
}

// ── 챔피언 인식 레퍼런스 (전역) ── kind: 'player'(초상화) | 'ban'(정사각 밴아이콘)
export async function listChampionRefs(kind = 'player') {
  const { data, error } = await db().from('champion_refs').select('champion, vec').eq('kind', kind).limit(2000);
  if (error) throw error;
  return data || [];
}

export async function addChampionRefs(items, kind = 'player') {
  // items: [{ champion, vec }]
  if (!items || !items.length) return;
  // 챔프당 과다 누적 방지: 챔프별 최대 8개 유지(초과시 추가 안 함)
  const { data: counts } = await db().from('champion_refs').select('champion').eq('kind', kind);
  const have = {};
  (counts || []).forEach((r) => { have[r.champion] = (have[r.champion] || 0) + 1; });
  const rows = items.filter((it) => it.champion && it.vec && (have[it.champion] || 0) < 8)
    .map((it) => ({ champion: it.champion, vec: it.vec, kind }));
  if (!rows.length) return;
  const { error } = await db().from('champion_refs').insert(rows);
  if (error) throw error;
}

// 관리자용: 모든 방 + 사람/경기/멤버 수 + 방장 이메일
export async function listAllGroupsAdmin() {
  const { data: groups, error } = await db().from('groups')
    .select('id, code, name, owner_id, created_at').order('created_at', { ascending: false });
  if (error) throw error;
  const cnt = async (table, gid) => (await db().from(table).select('*', { count: 'exact', head: true }).eq('group_id', gid)).count || 0;
  const out = [];
  for (const g of groups || []) {
    let ownerEmail = null;
    if (g.owner_id) {
      const { data } = await db().from('room_members').select('email').eq('group_id', g.id).eq('user_id', g.owner_id).maybeSingle();
      ownerEmail = data?.email || null;
    }
    out.push({
      ...g, ownerEmail,
      persons: await cnt('persons', g.id),
      matches: await cnt('matches', g.id),
      members: await cnt('room_members', g.id),
    });
  }
  return out;
}

// 방 통째로 삭제 (경기·참가자·사람·계정·레이팅·멤버까지). 방장 전용은 API에서 검사.
export async function deleteGroup(groupId) {
  if (!groupId) throw new Error('groupId 필요');
  const { data: persons } = await db().from('persons').select('id').eq('group_id', groupId);
  const pids = (persons || []).map((p) => p.id);
  const { data: matches } = await db().from('matches').select('id').eq('group_id', groupId);
  const mids = (matches || []).map((m) => m.id);
  if (mids.length) await db().from('match_participants').delete().in('match_id', mids);
  await db().from('matches').delete().eq('group_id', groupId);
  if (pids.length) {
    await db().from('match_participants').delete().in('person_id', pids); // 안전망
    await db().from('accounts').delete().in('person_id', pids);
    await db().from('rating_events').delete().in('person_id', pids);
  }
  await db().from('persons').delete().eq('group_id', groupId);
  await db().from('room_members').delete().eq('group_id', groupId);
  const { error } = await db().from('groups').delete().eq('id', groupId);
  if (error) throw error;
}

// ── 방별 점수표 ──
export async function getScoreTable(groupId) {
  if (!groupId) throw new Error('groupId 필요');
  const { data, error } = await db().from('groups').select('score_table').eq('id', groupId).single();
  if (error) throw error;
  return data.score_table || null; // null = 기본 표
}

export async function setScoreTable(groupId, table) {
  if (!groupId) throw new Error('groupId 필요');
  const { error } = await db().from('groups').update({ score_table: table }).eq('id', groupId);
  if (error) throw error;
}

// ── 저티어 자동보정 on/off (방 전체 설정) ── 컬럼 없으면 false 폴백
export async function getAdjustEnabled(groupId) {
  if (!groupId) return false;
  try {
    const { data, error } = await db().from('groups').select('adjust_enabled').eq('id', groupId).single();
    if (error) return false;
    return !!data?.adjust_enabled;
  } catch { return false; }
}

export async function setAdjustEnabled(groupId, enabled) {
  if (!groupId) throw new Error('groupId 필요');
  const { error } = await db().from('groups').update({ adjust_enabled: !!enabled }).eq('id', groupId);
  if (error) throw error;
}

// ── 칭호 노출 on/off (방 전체 설정) ── 컬럼 없으면 true 폴백(기본 표시)
export async function setShowAwards(groupId, enabled) {
  if (!groupId) throw new Error('groupId 필요');
  const { error } = await db().from('groups').update({ show_awards: !!enabled }).eq('id', groupId);
  if (error) throw error;
}

// ── 승률 보정(티어보정) on/off (방 전체) ── 컬럼 없으면 true(켜짐) 폴백
export async function getWinAdjEnabled(groupId) {
  if (!groupId) return true;
  try {
    const { data, error } = await db().from('groups').select('winadj_enabled').eq('id', groupId).single();
    if (error) return true;
    return data?.winadj_enabled !== false;
  } catch { return true; }
}
export async function setWinAdjEnabled(groupId, enabled) {
  if (!groupId) throw new Error('groupId 필요');
  const { error } = await db().from('groups').update({ winadj_enabled: !!enabled }).eq('id', groupId);
  if (error) throw error;
}

// ── 사람 (그룹 단위로 격리) ──
// 디코 유저ID로 이 방의 선수 찾기 (로그인=본인선수 자동매칭)
export async function findPersonByDiscord(groupId, discordId) {
  if (!groupId || !discordId) return null;
  const { data, error } = await db().from('persons')
    .select('id, display_name, nickname').eq('group_id', groupId).eq('discord_id', String(discordId)).maybeSingle();
  if (error) return null;
  return data || null;
}
// 로그인한 디코 계정을 특정 선수에 연결 (사이트에서 하는 /연동). 중복 연결 방지.
export async function linkPersonToDiscord(groupId, personId, discordId) {
  const dup = await findPersonByDiscord(groupId, discordId);
  if (dup && dup.id !== personId) { const e = new Error('이 디스코드 계정은 이미 다른 선수에 연결돼 있어요.'); e.status = 409; throw e; }
  const { data: tgt } = await db().from('persons').select('id, discord_id, group_id').eq('id', personId).maybeSingle();
  if (!tgt || tgt.group_id !== groupId) { const e = new Error('선수를 찾을 수 없어요.'); e.status = 404; throw e; }
  if (tgt.discord_id && String(tgt.discord_id) !== String(discordId)) { const e = new Error('이 선수는 이미 다른 계정에 연결돼 있어요. 관리자에게 문의하세요.'); e.status = 409; throw e; }
  await updatePerson(personId, { discord_id: String(discordId) });
  return { ok: true };
}

// 연동 해제 — discord_id만 null로. 기록(match_participants)은 그대로 보존.
export async function unlinkPersonDiscord(groupId, personId) {
  const { data: tgt } = await db().from('persons').select('id, group_id').eq('id', personId).maybeSingle();
  if (!tgt || tgt.group_id !== groupId) { const e = new Error('선수를 찾을 수 없어요.'); e.status = 404; throw e; }
  await updatePerson(personId, { discord_id: null });
  return { ok: true };
}

export async function listPersons(groupId) {
  if (!groupId) throw new Error('groupId 필요');
  const { data: persons, error } = await db().from('persons')
    .select('*').eq('group_id', groupId).order('created_at');
  if (error) throw error;
  const ids = persons.map((p) => p.id);
  let accounts = [];
  if (ids.length) {
    const { data, error: e2 } = await db().from('accounts').select('*').in('person_id', ids).order('created_at');
    if (e2) throw e2;
    accounts = data || [];
  }
  return persons.map((p) => ({ ...p, accounts: accounts.filter((a) => a.person_id === p.id) }));
}

export async function createPerson(groupId, p = {}) {
  if (!groupId) throw new Error('groupId 필요');
  const { data, error } = await db().from('persons').insert({
    group_id: groupId,
    display_name: p.display_name || '',
    base_tier: p.base_tier || 'G2',
    primary_positions: p.primary_positions || [],
    secondary_positions: p.secondary_positions || [],
    notes: p.notes || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updatePerson(id, patch) {
  const allowed = ['display_name', 'nickname', 'base_tier', 'secondary_tier', 'tier_locked', 'primary_positions', 'secondary_positions', 'adjust', 'rating_games', 'notes', 'discord_id', 'profile'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  const { data, error } = await db().from('persons').update(clean).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// 프로필 사진: 외부(디코 첨부) URL을 받아 Supabase Storage에 재호스팅 → 영구 public URL 반환.
// (디코 첨부 URL은 만료되므로 반드시 우리 저장소로 옮겨야 함). 버킷 없으면 자동 생성.
export async function uploadAvatarFromUrl(personId, srcUrl, contentType) {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error('이미지 다운로드 실패');
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = ((contentType || 'image/png').split('/')[1] || 'png').split('+')[0].replace(/[^a-z0-9]/gi, '') || 'png';
  const path = `${personId}.${ext}`;
  const sb = db();
  try { await sb.storage.createBucket('avatars', { public: true }); } catch { /* 이미 있음 */ }
  const up = await sb.storage.from('avatars').upload(path, buf, { contentType: contentType || 'image/png', upsert: true });
  if (up.error) throw up.error;
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  return data?.publicUrl || null;
}

export async function deletePerson(id) {
  // 🛡 기록 보호: 경기 기록이 하나라도 있으면 삭제 차단 (관리자 실수/악의로 기록 소실 방지)
  const { count } = await db().from('match_participants').select('*', { count: 'exact', head: true }).eq('person_id', id);
  if (count && count > 0) {
    const e = new Error(`이 선수는 ${count}경기 기록이 있어 삭제할 수 없어요. (기록 보호) — 중복이면 '병합', 잘못된 연동이면 '연동 해제'를 쓰세요.`);
    e.status = 409; throw e;
  }
  // 기록 없는 빈 선수만 삭제 (accounts·rating_events는 cascade)
  const { error } = await db().from('persons').delete().eq('id', id);
  if (error) throw error;
}

export async function addAccount(a) {
  const region = a.region || 'NA';
  // 이 계정이 속할 방(그룹) — 유니크·중복확인은 방 단위. 같은 닉이 다른 방엔 각각 등록 가능.
  const { data: person } = await db().from('persons').select('group_id').eq('id', a.person_id).maybeSingle();
  const groupId = person?.group_id || null;
  // 이 방 안에 이미 등록된 계정인지 확인 → 친절한 안내 (raw unique 에러 대신). 다른 방은 안 본다.
  const { data: existing } = await db().from('accounts')
    .select('id, person_id').eq('group_id', groupId).eq('game_name', a.game_name).eq('tag_line', a.tag_line).eq('region', region).maybeSingle();
  if (existing) {
    if (existing.person_id === a.person_id) return existing; // 같은 사람 = 이미 있음, 그냥 반환
    const { data: owner } = await db().from('persons').select('display_name').eq('id', existing.person_id).maybeSingle();
    const e = new Error(`이 방에 계정(${a.game_name}#${a.tag_line})이 이미 "${owner?.display_name || '다른 선수'}" 에 등록돼 있어요. 같은 사람이면 '합치기'를 쓰세요.`);
    e.status = 409; throw e;
  }
  // 첫 계정이면 자동 본캐
  const { count } = await db().from('accounts').select('*', { count: 'exact', head: true }).eq('person_id', a.person_id);
  const { data, error } = await db().from('accounts').insert({
    person_id: a.person_id, group_id: groupId, game_name: a.game_name, tag_line: a.tag_line, region,
    is_main: a.is_main ?? (count === 0),
    opgg_tier: a.opgg_tier || null, opgg_games: a.opgg_games ?? null,
    opgg_confidence: a.opgg_confidence || null, last_synced_at: new Date().toISOString(),
  }).select().single();
  if (error) {
    if (error.code === '23505') { const e = new Error(`이 방에 계정(${a.game_name}#${a.tag_line})이 이미 등록돼 있어요.`); e.status = 409; throw e; }
    throw error;
  }
  await recomputeBaseTier(a.person_id); // 계정 추가 → 가장 높은 티어로 base_tier 갱신
  return data;
}

export async function deleteAccount(id) {
  const { data: acc } = await db().from('accounts').select('person_id').eq('id', id).maybeSingle();
  const { error } = await db().from('accounts').delete().eq('id', id);
  if (error) throw error;
  if (acc?.person_id) await recomputeBaseTier(acc.person_id); // 계정 삭제 → 남은 계정 기준 재계산
}

// 계정 티어 갱신 (op.gg 재조회 결과 반영) → base_tier 재계산. 계정 재추가 없이 랭크만 새로고침.
export async function updateAccountTier(accountId, { opgg_tier, opgg_games, opgg_confidence }) {
  const { data: acc } = await db().from('accounts').select('person_id').eq('id', accountId).maybeSingle();
  if (!acc) throw new Error('계정을 찾을 수 없어요');
  const { error } = await db().from('accounts').update({
    opgg_tier: opgg_tier || null, opgg_games: opgg_games ?? null, opgg_confidence: opgg_confidence || null,
    last_synced_at: new Date().toISOString(),
  }).eq('id', accountId);
  if (error) throw error;
  await recomputeBaseTier(acc.person_id); // 계정 티어 → 사람 base_tier 반영(더 높으면 상향)
  return acc.person_id;
}

// 오래된 계정 티어 자동 갱신 (신청 트리거용). maxAge 지난 계정만 op.gg 재조회 → base_tier 반영.
// best-effort: op.gg 실패·에러는 조용히 무시(신청 흐름 안 막음). 최근 갱신된 계정은 스킵(과부하 방지).
export async function refreshStalePersonTiers(personId, maxAgeMs = 7 * 24 * 3600 * 1000) {
  if (!personId) return;
  try {
    const { data: person } = await db().from('persons').select('tier_locked').eq('id', personId).maybeSingle();
    if (person?.tier_locked) return; // 수동 고정 → 자동 갱신 대상 아님 (op.gg 재조회조차 안 함)
    const { data: accts } = await db().from('accounts')
      .select('id, game_name, tag_line, region, last_synced_at').eq('person_id', personId);
    if (!accts?.length) return;
    const now = Date.now();
    for (const a of accts) {
      const age = a.last_synced_at ? now - new Date(a.last_synced_at).getTime() : Infinity;
      if (age < maxAgeMs) continue; // 최근(7일 내) 갱신 → 스킵
      try {
        const est = await fetchTierEstimate(a.game_name, a.tag_line, a.region || 'NA');
        if (est && est.found !== false && est.suggestedTier) {
          await updateAccountTier(a.id, { opgg_tier: est.suggestedTier, opgg_games: est.games, opgg_confidence: est.confidence });
        }
      } catch { /* 계정 하나 실패해도 나머지 진행 */ }
    }
  } catch { /* 갱신 실패는 무시 */ }
}

// ── 신고 (비공개 · 운영자만 조회 · 판단용 축적) ──
export async function createReport(r) {
  const row = {
    gid: r.gid || null,
    reporter_discord_id: r.reporterDiscordId || null, reporter_name: r.reporterName || null,
    target_discord_id: r.targetDiscordId || null, target_name: r.targetName || null,
    category: r.category || 'other', detail: r.detail || null,
  };
  const { data, error } = await db().from('reports').insert(row).select().single();
  if (error) {
    if (/reports|does not exist|schema cache/i.test(error.message || '')) throw new Error('신고 마이그레이션(reports-schema.sql)을 먼저 실행하세요');
    throw error;
  }
  return data;
}

export async function listReports(gid, { limit = 100 } = {}) {
  if (!gid) return [];
  const { data, error } = await db().from('reports')
    .select('*').eq('gid', gid).order('created_at', { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

export async function setReportStatus(id, status) {
  if (!['open', 'reviewed', 'dismissed', 'actioned'].includes(status)) throw new Error('status 값 오류');
  const { error } = await db().from('reports').update({ status }).eq('id', id);
  if (error) throw error;
}

// 신고 알림 채널 (비공개) — 서버 관리자가 /신고채널 로 지정. 새 신고가 여기로 포스팅됨.
export async function setGuildReportChannel(guildId, channelId) {
  const { error } = await db().from('discord_guilds').update({ report_channel_id: channelId || null }).eq('guild_id', guildId);
  if (error) { if (/report_channel/i.test(error.message || '')) throw new Error('신고 마이그레이션(reports-schema.sql)을 먼저 실행하세요'); throw error; }
}
export async function getGuildReportChannel(guildId) {
  if (!guildId) return null;
  try {
    const { data } = await db().from('discord_guilds').select('report_channel_id').eq('guild_id', guildId).maybeSingle();
    return data?.report_channel_id || null;
  } catch { return null; }
}

// 본캐 지정 (같은 사람의 다른 계정은 해제)
export async function setMainAccount(accountId, personId) {
  await db().from('accounts').update({ is_main: false }).eq('person_id', personId);
  const { error } = await db().from('accounts').update({ is_main: true }).eq('id', accountId);
  if (error) throw error;
}

// ── 경기 기록 (레이팅 보정은 일단 제외 — 판수만 카운트) ──
async function bumpGames(participants) {
  const ids = [...new Set(participants.map((p) => p.person_id))];
  if (!ids.length) return;
  const { data: persons, error } = await db().from('persons')
    .select('id, rating_games').in('id', ids);
  if (error) throw error;
  await Promise.all((persons || []).map((person) =>
    db().from('persons').update({ rating_games: (person.rating_games || 0) + 1 }).eq('id', person.id)
  ));
}

// 이름으로 사람 찾기 (없으면 자동 등록). 게스트·오타도 일단 남김 → 나중에 병합.
async function findOrCreatePerson(groupId, name, tier, primary, secondary) {
  const nm = (name || '').trim();
  if (!nm) throw new Error('이름이 빈 참가자가 있습니다');
  // 태그·공백·대소문자·보이지 않는 문자 무시하고 매칭 → 태그 변형으로 중복 사람 생기는 것 방지
  const norm = (s) => stripInvisible(s).split('#')[0].toLowerCase().replace(/\s+/g, '');
  const key = norm(nm);
  const { data: rows, error } = await db().from('persons')
    .select('id, display_name, nickname').eq('group_id', groupId);
  if (error) throw error;
  // 인게임 이름 매칭은 display_name 으로만. 디코 별명(nickname)은 가변·타인 인게임닉과 충돌하므로 키에서 제외.
  const hit = (rows || []).find((p) => norm(p.display_name) === key);
  if (hit) return hit.id;
  const cleanName = stripInvisible(nm).trim() || nm; // #태그 보존 (인게임닉 = 이름#태그)
  const p = await createPerson(groupId, {
    display_name: cleanName, base_tier: tier || 'G2',
    primary_positions: primary || [], secondary_positions: secondary || [],
  });
  return p.id;
}

// 이미 저장된 같은 경기인지 판정. 두 갈래로 잡는다:
//  (1) 챔피언 멀티셋 동일 + KDA 근접 — person_id 무관. 리플/스샷 소스가 달라 사람 매칭이 어긋나도 잡힘(핵심).
//  (2) 같은 사람들 + 챔피언 거의 일치 + KDA 근접 — 스샷 재업로드(챔피언 1개 오독 허용).
// (같은 멤버가 다른 게임을 또 할 수 있으므로 KDA 근접이 핵심 판별자 — 딜량/CS는 무시)
async function findDuplicateMatch(groupId, resolved, winner) {
  const norm = (c) => (c || '').toLowerCase().trim();
  const incParts = resolved.map((p) => ({
    person_id: p.person_id, champion: norm(p.champion),
    k: +(p.k ?? p.kills ?? 0), d: +(p.d ?? p.deaths ?? 0), a: +(p.a ?? p.assists ?? 0),
  }));
  // KDA·챔피언 정보가 하나도 없으면(승패만 입력) 다른 게임과 구분 불가 → 중복검사 스킵
  const hasDetail = resolved.some((p) => (p.champion || p.k != null || p.kills != null));
  if (!hasDetail) return null;
  const incIds = incParts.map((p) => p.person_id).sort().join(',');
  const incChamps = incParts.map((p) => p.champion).filter(Boolean).sort().join(',');
  // 챔피언→KDA 순 정렬 (person_id 무관 페어링용)
  const sortKda = (arr) => [...arr].sort((x, y) =>
    (x.champion < y.champion ? -1 : x.champion > y.champion ? 1 : 0) || (x.k - y.k) || (x.d - y.d) || (x.a - y.a));
  const incSorted = sortKda(incParts);

  const { data: matches } = await db().from('matches')
    .select('id, winner').eq('group_id', groupId).order('created_at', { ascending: false }).limit(300);
  if (!matches?.length) return null;
  const mids = matches.map((m) => m.id);
  const { data: parts } = await db().from('match_participants')
    .select('match_id, person_id, champion, kills, deaths, assists').in('match_id', mids);
  const byMatch = {};
  (parts || []).forEach((p) => { (byMatch[p.match_id] = byMatch[p.match_id] || []).push(p); });

  for (const m of matches) {
    if (m.winner !== winner) continue;
    const list = (byMatch[m.id] || []).map((p) => ({
      person_id: p.person_id, champion: norm(p.champion), k: p.kills || 0, d: p.deaths || 0, a: p.assists || 0,
    }));
    if (list.length !== incParts.length) continue;

    // (1) 챔피언 멀티셋 동일 + KDA 근접 (person_id 무관) — 리플 재저장·소스 불일치까지 견고하게 잡음
    const listChamps = list.map((p) => p.champion).filter(Boolean).sort().join(',');
    if (incChamps && listChamps === incChamps) {
      const ls = sortKda(list);
      let kdaDiff = 0;
      for (let i = 0; i < ls.length; i++) {
        kdaDiff += Math.abs(ls[i].k - incSorted[i].k) + Math.abs(ls[i].d - incSorted[i].d) + Math.abs(ls[i].a - incSorted[i].a);
      }
      if (kdaDiff <= 8) return m.id;
    }

    // (2) 같은 사람들 기준 (스샷: 챔피언 1개 오독 허용)
    if (list.map((p) => p.person_id).sort().join(',') === incIds) {
      const incByPid = new Map(incParts.map((p) => [p.person_id, p]));
      let champMatch = 0, kdaDiff = 0, ok = true;
      for (const p of list) {
        const q = incByPid.get(p.person_id);
        if (!q) { ok = false; break; }
        if (p.champion === q.champion) champMatch++;
        kdaDiff += Math.abs(p.k - q.k) + Math.abs(p.d - q.d) + Math.abs(p.a - q.a);
      }
      if (ok && champMatch >= incParts.length - 1 && kdaDiff <= 8) return m.id;
    }
  }
  return null;
}

// participants: [{ name, tier, primary, secondary, team:'A'|'B', position, points }]
export async function saveMatch(groupId, { winner, totalWeight, participants, force, durationMin, durationSec, objectives, source, played_at }) {
  if (!groupId) throw new Error('groupId 필요');
  if (winner !== 'A' && winner !== 'B') throw new Error('winner는 A/B');
  if (!participants || participants.length !== 10) throw new Error('참가자 10명 필요');
  // 등록 안 된 이름은 자동 등록하고 person_id 해결
  const resolved = [];
  for (const p of participants) {
    const person_id = p.person_id || await findOrCreatePerson(groupId, p.name, p.tier, p.primary, p.secondary);
    resolved.push({ ...p, person_id, tier_at_match: p.tier_at_match || p.tier });
  }
  // 중복 경기 방지 (force면 무시하고 저장)
  if (!force) {
    const dupId = await findDuplicateMatch(groupId, resolved, winner);
    if (dupId) return { duplicate: true, matchId: dupId };
  }
  const durSec = durationSec != null ? Math.round(durationSec) : (durationMin ? Math.round(durationMin * 60) : null);
  const dur = durSec != null ? Math.round(durSec / 60) : null;
  const baseIns = { group_id: groupId, winner, total_weight: totalWeight ?? null, ...(played_at ? { played_at } : {}) };
  // 리플 상세(objectives·source)·duration은 추가 컬럼 — 있으면 저장, 스키마 미반영이면 단계적으로 빼고 재시도(기존 저장 항상 되게)
  let ins = await db().from('matches')
    .insert({ ...baseIns, duration_min: dur, duration_sec: durSec, source: source ?? null, objectives: objectives ?? null }).select().single();
  if (ins.error && /duration_sec/i.test(ins.error.message || '')) { // duration_sec 컬럼만 없음 → objectives/source 유지
    ins = await db().from('matches').insert({ ...baseIns, duration_min: dur, source: source ?? null, objectives: objectives ?? null }).select().single();
  }
  if (ins.error && /(duration_min|source|objectives)/i.test(ins.error.message || '')) {
    ins = await db().from('matches').insert({ ...baseIns, duration_min: dur }).select().single();
    if (ins.error && /duration_min/i.test(ins.error.message || '')) ins = await db().from('matches').insert(baseIns).select().single();
  }
  const { data: match, error } = ins;
  if (error) throw error;
  const rows = resolved.map((p, idx) => ({
    match_id: match.id, person_id: p.person_id, team: p.team,
    position: p.position ?? null,
    tier_at_match: p.tier_at_match ?? null, points: p.points ?? null,
    win: p.team === winner,
    champion: p.champion ?? null,
    kills: p.k ?? p.kills ?? null,
    deaths: p.d ?? p.deaths ?? null,
    assists: p.a ?? p.assists ?? null,
    cs: p.cs ?? null,
    gold: p.gold ?? null,
    damage: p.damage ?? null,
    slot: idx, // 스샷 위→아래 순서 보존
    detail: p.detail ?? null, // 리플 상세(아이템·비전 등). 스샷/수동이면 null.
  }));
  let { error: e2 } = await db().from('match_participants').insert(rows);
  // slot·detail 컬럼이 아직 없으면(스키마 미적용) 빼고 재시도 → 저장은 항상 되게
  if (e2 && /(slot|detail)/i.test(e2.message || '')) {
    ({ error: e2 } = await db().from('match_participants').insert(rows.map(({ slot, detail, ...r }) => r)));
  }
  if (e2) {
    // 참가자 저장 실패 → 방금 만든 경기 행 정리 (고아 경기 방지)
    await db().from('matches').delete().eq('id', match.id);
    throw e2;
  }
  await bumpGames(resolved);
  return match;
}

// 경기 1건 삭제: 참가자·경기 삭제 + 참가자들의 rating_games 되돌리기(감소)
export async function deleteMatch(matchId) {
  if (!matchId) throw new Error('matchId 필요');
  const { data: parts } = await db().from('match_participants').select('person_id').eq('match_id', matchId);
  const { error: e1 } = await db().from('match_participants').delete().eq('match_id', matchId);
  if (e1) throw e1;
  const { error: e2 } = await db().from('matches').delete().eq('id', matchId);
  if (e2) throw e2;
  const counts = {};
  (parts || []).forEach((p) => { counts[p.person_id] = (counts[p.person_id] || 0) + 1; });
  for (const [pid, c] of Object.entries(counts)) {
    const { data: person } = await db().from('persons').select('rating_games').eq('id', pid).single();
    if (person) await db().from('persons').update({ rating_games: Math.max(0, (person.rating_games || 0) - c) }).eq('id', pid);
  }
}

// 경기 1건 편집용 로드 (record 페이지 프리필)
export async function getMatchForEdit(matchId) {
  const { data: match, error } = await db().from('matches').select('*').eq('id', matchId).maybeSingle();
  if (error) throw error;
  if (!match) throw new Error('경기 없음');
  const { data: parts } = await db().from('match_participants').select('*').eq('match_id', matchId);
  const persons = await listPersons(match.group_id);
  const nameById = Object.fromEntries(persons.map((p) => [p.id, p.display_name]));
  const participants = (parts || [])
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
    .map((p) => ({
      person_id: p.person_id, name: nameById[p.person_id] || '?', team: p.team,
      champion: p.champion || '', k: p.kills || 0, d: p.deaths || 0, a: p.assists || 0,
      damage: p.damage || 0, cs: p.cs || 0,
    }));
  return { id: match.id, group_id: match.group_id, winner: match.winner, durationMin: match.duration_min || 0,
    durationSec: match.duration_sec ?? (match.duration_min != null ? match.duration_min * 60 : 0), participants };
}

// 경기 1건 수정: 참가자 교체 + 승리팀/시간 갱신 (중복검사 없음, rating_games는 그대로)
export async function updateMatch(groupId, matchId, { winner, participants, durationMin, durationSec }) {
  if (!matchId) throw new Error('matchId 필요');
  if (winner !== 'A' && winner !== 'B') throw new Error('winner는 A/B');
  if (!participants || participants.length !== 10) throw new Error('참가자 10명 필요');
  const resolved = [];
  for (const p of participants) {
    const person_id = p.person_id || await findOrCreatePerson(groupId, p.name, p.tier, p.primary, p.secondary);
    resolved.push({ ...p, person_id, tier_at_match: p.tier_at_match || p.tier });
  }
  // 삭제 전 기존 참가자 백업 — 새 참가자 insert가 실패하면 복원 (삭제→삽입 사이 유실 방지)
  const { data: backup } = await db().from('match_participants').select('*').eq('match_id', matchId);
  await db().from('match_participants').delete().eq('match_id', matchId);
  // durationSec 우선, 없으면 durationMin. 둘 다 없으면 시간 컬럼 건드리지 않음.
  const durSec = durationSec != null ? Math.round(durationSec) : (durationMin != null ? (durationMin ? Math.round(durationMin * 60) : null) : undefined);
  const upd = { winner };
  if (durSec !== undefined) { upd.duration_sec = durSec; upd.duration_min = durSec != null ? Math.round(durSec / 60) : null; }
  let e = (await db().from('matches').update(upd).eq('id', matchId)).error;
  if (e && /duration_sec/i.test(e.message || '')) { const { duration_sec, ...u2 } = upd; e = (await db().from('matches').update(u2).eq('id', matchId)).error; }
  if (e && /duration_min/i.test(e.message || '')) e = (await db().from('matches').update({ winner }).eq('id', matchId)).error;
  if (e) throw e;
  const rows = resolved.map((p, idx) => ({
    match_id: matchId, person_id: p.person_id, team: p.team, position: p.position ?? null,
    tier_at_match: p.tier_at_match ?? null, points: p.points ?? null, win: p.team === winner,
    champion: p.champion ?? null, kills: p.k ?? p.kills ?? null, deaths: p.d ?? p.deaths ?? null,
    assists: p.a ?? p.assists ?? null, cs: p.cs ?? null, gold: p.gold ?? null, damage: p.damage ?? null, slot: idx,
  }));
  let { error: e2 } = await db().from('match_participants').insert(rows);
  if (e2 && /slot/i.test(e2.message || '')) ({ error: e2 } = await db().from('match_participants').insert(rows.map(({ slot, ...r }) => r)));
  if (e2) {
    if (backup?.length) {
      const restore = backup.map(({ id, ...r }) => r); // id 재발급
      await db().from('match_participants').insert(restore);
    }
    throw e2;
  }
  return { id: matchId };
}

// 블루↔레드 뒤집기: 수동 업로드 시 진영이 반대로 들어간 경기 보정.
// 참가자 team A↔B, win 재계산, 경기 winner 반전, objectives A/B 스왑.
export async function swapSides(groupId, matchId) {
  if (!matchId) throw new Error('matchId 필요');
  const { data: m } = await db().from('matches').select('winner, objectives').eq('id', matchId).maybeSingle();
  if (!m) throw new Error('경기를 찾을 수 없어요');
  const newWinner = m.winner === 'A' ? 'B' : m.winner === 'B' ? 'A' : m.winner;
  const { data: ps, error: pe } = await db().from('match_participants').select('id, team').eq('match_id', matchId);
  if (pe) throw pe;
  for (const p of ps || []) {
    const t = p.team === 'A' ? 'B' : p.team === 'B' ? 'A' : p.team;
    if (t !== p.team) await db().from('match_participants').update({ team: t, win: t === newWinner }).eq('id', p.id);
  }
  const upd = { winner: newWinner };
  const obj = m.objectives;
  if (obj && (obj.A || obj.B)) upd.objectives = { A: obj.B || {}, B: obj.A || {} };
  let { error } = await db().from('matches').update(upd).eq('id', matchId);
  if (error && /objectives/i.test(error.message || '')) { // objectives 컬럼 없으면 winner만
    ({ error } = await db().from('matches').update({ winner: newWinner }).eq('id', matchId));
  }
  if (error) throw error;
  return { id: matchId, winner: newWinner };
}

// 두 사람 병합: mergeId(흡수될 쪽)의 계정·기록·레이팅을 keepId로 옮기고 삭제
export async function mergePersons(keepId, mergeId) {
  if (!keepId || !mergeId || keepId === mergeId) throw new Error('서로 다른 두 사람을 선택하세요');
  const { data: m, error } = await db().from('persons').select('rating_games').eq('id', mergeId).single();
  if (error) throw error;
  const { data: k, error: e2 } = await db().from('persons').select('rating_games').eq('id', keepId).single();
  if (e2) throw e2;
  await db().from('accounts').update({ person_id: keepId }).eq('person_id', mergeId);
  await db().from('match_participants').update({ person_id: keepId }).eq('person_id', mergeId);
  await db().from('rating_events').update({ person_id: keepId }).eq('person_id', mergeId);
  await db().from('persons').update({ rating_games: (k.rating_games || 0) + (m.rating_games || 0) }).eq('id', keepId);
  const { error: e3 } = await db().from('persons').delete().eq('id', mergeId);
  if (e3) throw e3;
}

// 같은 인게임 닉(#태그·공백 무시) 중복 사람 자동 병합 + 모든 display_name 태그 정리(표시 통일: 순수 닉).
// Riot ID에 껴있는 보이지 않는 방향/제어 문자 제거 (U+200B~F, U+202A~E, U+2060~6F, BOM)
const stripInvisible = (s) => (s || '').replace(/[​-‏‪-‮⁠-⁯﻿]/g, '');
export async function dedupeByNick(groupId) {
  const persons = await listPersons(groupId);
  const norm = (s) => stripInvisible(s).split('#')[0].toLowerCase().replace(/\s+/g, '');
  const groups = {};
  persons.forEach((p) => { const k = norm(p.display_name); if (k) (groups[k] = groups[k] || []).push(p); });
  let merged = 0;
  for (const list of Object.values(groups)) {
    if (list.length < 2) continue;
    const keep = list.find((p) => p.base_tier && p.base_tier !== 'G2') || list[0];
    for (const p of list) {
      if (p.id === keep.id) continue;
      await mergePersons(keep.id, p.id);
      merged++;
    }
  }
  // 병합 후, 보이지 않는 문자만 정리 (#태그는 보존 — 인게임닉 = 이름#태그)
  let cleaned = 0;
  const after = await listPersons(groupId);
  for (const p of after) {
    const clean = stripInvisible(p.display_name).trim();
    if (clean && clean !== p.display_name) { await updatePerson(p.id, { display_name: clean }); cleaned++; }
  }
  return { merged, cleaned };
}

// ── 내전 모집 큐 (디스코드 봇) ── 상태는 recruit_queues / recruit_signups 에 저장(서버리스라 무상태)
// 디코↔사이트 양방향 동기화: 큐 테이블이 단일 진실. channel_id/message_id 로 사이트→디코 메시지 갱신.
export async function createQueue(gid, size, hostId, channelId, gameType = 'lol') {
  const base = { gid, size, status: 'open', host_id: hostId || null, channel_id: channelId || null, game_type: gameType };
  let { data, error } = await db().from('recruit_queues').insert(base).select().single();
  if (error && /game_type/i.test(error.message || '')) { const { game_type, ...b } = base; ({ data, error } = await db().from('recruit_queues').insert(b).select().single()); } // 컬럼 미생성 폴백
  if (error) throw error;
  return data;
}

export async function getQueue(id) {
  if (!id) return null;
  const { data, error } = await db().from('recruit_queues').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// gid의 가장 최근 열린 큐 (사이트가 "오늘 내전" 으로 미러링). gameType별로 분리(lol/tft 동시 가능).
export async function getOpenQueue(gid, gameType = 'lol') {
  if (!gid) return null;
  let q = db().from('recruit_queues').select('*').eq('gid', gid).eq('status', 'open');
  try { q = q.eq('game_type', gameType); } catch { /* 컬럼 미생성 → 필터 생략 */ }
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return null; // game_type 컬럼 없거나 조회 실패 → 안전하게 null
  return data;
}

// 디코 메시지 ID 저장 (생성 직후 @original 조회 결과) → 나중에 사이트에서 그 메시지를 PATCH
export async function setQueueMessage(id, channelId, messageId) {
  const { error } = await db().from('recruit_queues')
    .update({ channel_id: channelId, message_id: messageId }).eq('id', id);
  if (error) throw error;
}

export async function closeQueue(id) {
  const { error } = await db().from('recruit_queues').update({ status: 'closed' }).eq('id', id);
  if (error) throw error;
}

// 10↔20 인원 전환 (신청자·대기 그대로 유지 — size만 변경, 재배정은 렌더 때 자동).
export async function setQueueSize(id, size) {
  const sz = size === 20 ? 20 : 10;
  const { error } = await db().from('recruit_queues').update({ size: sz }).eq('id', id);
  if (error) throw error;
}

// 마감 번복 → 다시 열기 (호스트). 같은 방에 다른 열린 모집이 있으면 거부(한 방 한 모집 규칙).
export async function reopenQueue(id) {
  const { data: q } = await db().from('recruit_queues').select('id, gid, game_type').eq('id', id).maybeSingle();
  if (!q) throw new Error('모집을 찾을 수 없어요');
  let other = db().from('recruit_queues').select('id').eq('gid', q.gid).eq('status', 'open').neq('id', id);
  try { other = other.eq('game_type', q.game_type || 'lol'); } catch { /* 컬럼 없으면 생략 */ }
  const { data: others } = await other.limit(1);
  if (others && others.length) { const e = new Error('이미 다른 열린 모집이 있어요 — 그걸 먼저 마감하세요.'); e.status = 400; throw e; }
  const { error } = await db().from('recruit_queues').update({ status: 'open' }).eq('id', id);
  if (error) throw error;
}

export async function listSignups(queueId) {
  const { data, error } = await db().from('recruit_signups')
    .select('*').eq('queue_id', queueId).order('created_at', { ascending: true }); // created_at = 선착순
  if (error) throw error;
  return data || [];
}

export async function getSignup(queueId, discordId) {
  const { data, error } = await db().from('recruit_signups')
    .select('*').eq('queue_id', queueId).eq('discord_id', discordId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// patch: { name?, main?, sub? } — 있으면 갱신(created_at 유지=선착순 보존), 없으면 신규
export async function upsertSignup(queueId, discordId, patch) {
  const ex = await getSignup(queueId, discordId);
  if (ex) {
    const { error } = await db().from('recruit_signups').update(patch).eq('id', ex.id);
    if (error) throw error;
  } else {
    const { error } = await db().from('recruit_signups').insert({ queue_id: queueId, discord_id: discordId, ...patch });
    if (error) throw error;
  }
}

export async function removeSignup(queueId, discordId) {
  const { error } = await db().from('recruit_signups').delete().eq('queue_id', queueId).eq('discord_id', discordId);
  if (error) throw error;
}

// 사이트에서 강퇴: 시그넙 행 id 로 삭제 (discord_id 미노출이라 행 id 사용)
export async function removeSignupById(id) {
  const { error } = await db().from('recruit_signups').delete().eq('id', id);
  if (error) throw error;
}

// 관리자 라인 이동: 시그넙의 주라인 변경 (재배정으로 그 라인으로 감)
export async function setSignupMain(id, main) {
  const { error } = await db().from('recruit_signups').update({ main }).eq('id', id);
  if (error) throw error;
}

// ── 스샷 판독 대기(확인 전) ── 디코에서 판독→확인 버튼까지 잠깐 보관. 확인 시 saveMatch, 취소 시 삭제.
// 밸런스 리롤 pending은 확인 단계가 없어 안 지워짐 → 생성 때마다 24h 지난 행 청소 (무한 누적 방지)
export async function createPending(gid, data) {
  try {
    await db().from('pending_matches').delete()
      .lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  } catch { /* 청소 실패해도 생성은 진행 */ }
  const { data: row, error } = await db().from('pending_matches').insert({ gid, data }).select('id').single();
  if (error) throw error;
  return row.id;
}
export async function getPending(id) {
  if (!id) return null;
  const { data, error } = await db().from('pending_matches').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function updatePending(id, data) {
  const { error } = await db().from('pending_matches').update({ data }).eq('id', id);
  if (error) throw error;
}
export async function deletePending(id) {
  await db().from('pending_matches').delete().eq('id', id);
}

// ── 통계 (승패 + 스샷 추출 상세: KDA/CS/골드/챔프) ──
// 내전 승률 보정용 — 사람ID → { wins, games }. 밸런스(팀편성)에서 winrateAdj 계산에 씀.
export async function winStatById(groupId) {
  try {
    const { players } = await getStats(groupId);
    return new Map((players || []).map((p) => [p.id, { wins: p.wins || 0, games: p.games || 0 }]));
  } catch { return new Map(); }
}

export async function getStats(groupId) {
  const persons = await listPersons(groupId);
  const ids = persons.map((p) => p.id);
  let parts = [];
  if (ids.length) {
    // select('*') = 마이그레이션 전(gold 컬럼 없음)에도 안 깨짐
    const { data, error } = await db().from('match_participants').select('*').in('person_id', ids);
    if (error) throw error;
    parts = data || [];
  }
  const { count: matchCount } = await db().from('matches')
    .select('*', { count: 'exact', head: true }).eq('group_id', groupId);

  // 경기별 게임시간(분) → 분당 CS 계산용. duration_min 컬럼 없으면 빈 맵.
  const durById = {};
  try {
    const { data: ms } = await db().from('matches').select('id, duration_min').eq('group_id', groupId);
    (ms || []).forEach((m) => { if (m.duration_min) durById[m.id] = m.duration_min; });
  } catch { /* 컬럼 미반영 → 분당 CS는 집계 안 됨 */ }

  // ── MVP/ACE: op.gg식 근사 점수(KDA·킬관여·딜량·CS 비중) — 정식 공식은 비공개 ──
  // 경기별로 승리팀 최고점=MVP, 패배팀 최고점=ACE. 사람별 누적.
  // 골드/CS 토글: gold가 있으면 gold, 없으면 cs 사용 (기록 탭과 동일 기준으로 통일)
  const econ = (m) => m.gold || m.cs || 0;
  const mvpCount = {}, aceCount = {};
  const byMatch = {};
  parts.forEach((m) => { if (m.kills != null) (byMatch[m.match_id] = byMatch[m.match_id] || []).push(m); });
  const opScore = (m, tK, tD, tG) => {
    // KDA 상한 10 → 0데스 서폿의 18~19 KDA 폭주 차단(서폿 KDA는 여전히 유리, 상한만). 딜·KP 비중 상향.
    const kda = Math.min((m.kills + (m.assists || 0)) / Math.max(1, m.deaths || 0), 10);
    const kp = (m.kills + (m.assists || 0)) / Math.max(1, tK);
    const dmgShare = (m.damage || 0) / Math.max(1, tD);
    const econShare = econ(m) / Math.max(1, tG);
    return kda * 0.6 + kp * 5 + dmgShare * 22.5 + econShare * 3 - (m.deaths || 0) * 0.5;
  };
  Object.values(byMatch).forEach((list) => {
    const tot = {};
    list.forEach((m) => {
      const t = (tot[m.team] = tot[m.team] || { k: 0, d: 0, g: 0 });
      t.k += m.kills || 0; t.d += m.damage || 0; t.g += econ(m);
    });
    const scored = list.map((m) => ({ m, s: opScore(m, tot[m.team].k, tot[m.team].d, tot[m.team].g) }));
    const winners = scored.filter((x) => x.m.win), losers = scored.filter((x) => !x.m.win);
    const top = (arr) => arr.reduce((b, x) => (!b || x.s > b.s ? x : b), null);
    const mvp = top(winners), ace = top(losers);
    if (mvp) mvpCount[mvp.m.person_id] = (mvpCount[mvp.m.person_id] || 0) + 1;
    if (ace) aceCount[ace.m.person_id] = (aceCount[ace.m.person_id] || 0) + 1;
  });

  // 자동보정용 개인 신호: 역할 중립 기여도 = 킬관여(KP) − 데스비중. 경기 내 등수(1~10) 누적.
  //   딜 안 씀 → 탱/서폿 공정. 잘하는 탱=안 죽고 관여↑ → 상위. 던지는 애=데스↑ 관여↓ → 하위.
  const contribRankSum = {}, contribRankCnt = {};
  Object.values(byMatch).forEach((list) => {
    const tk = {}, td = {};
    list.forEach((m) => { tk[m.team] = (tk[m.team] || 0) + (m.kills || 0); td[m.team] = (td[m.team] || 0) + (m.deaths || 0); });
    const scored = list.map((m) => {
      const kp = ((m.kills || 0) + (m.assists || 0)) / Math.max(1, tk[m.team]);
      const ds = (m.deaths || 0) / Math.max(1, td[m.team]);
      return { id: m.person_id, c: kp - ds };
    }).sort((a, b) => b.c - a.c);
    scored.forEach((s, i) => { contribRankSum[s.id] = (contribRankSum[s.id] || 0) + (i + 1); contribRankCnt[s.id] = (contribRankCnt[s.id] || 0) + 1; });
  });
  // 에메랄드↓(E·P·G·S)만 보정. 자동보정값 계산 (±8 캡, 판수 신뢰도 스케일).
  const LOW = new Set(['E', 'P', 'G', 'S']);
  const autoAdjOf = (baseTier, games, wins, id) => {
    if (!LOW.has((baseTier || '')[0]) || !games) return 0;
    const cnt = contribRankCnt[id] || 0;
    const avgRank = cnt ? contribRankSum[id] / cnt : 5.5;
    const winSignal = ((wins + 2) / (games + 4) - 0.5) * 2;  // 승률(라플라스) → −1~+1
    const perfSignal = (5.5 - avgRank) / 4.5;                // 개인 기여 등수 → −1~+1
    const raw = 0.5 * winSignal + 0.5 * perfSignal;
    const conf = games / (games + 6);                        // 판수 신뢰도 (급변 방지)
    const auto = Math.max(-8, Math.min(8, raw * 12 * conf)); // 배율 12, ±8 캡
    return Math.round(auto * 10) / 10;
  };

  // 포지션 유도: 스샷 행 순서(slot) 기준. team A=slot0~4, B=slot5~9 → slot%5 = 탑·정글·미드·원딜·서폿.
  //   명시적 position 컬럼이 있으면 그걸 우선.
  const POS_KEYS = ['top', 'jungle', 'mid', 'adc', 'sup'];
  const posOf = (m) => (m.position && POS_KEYS.includes(m.position) ? m.position : (m.slot != null ? POS_KEYS[((m.slot % 5) + 5) % 5] : null));
  // 점수 공식(리더보드와 동일) — 라인별 리더보드에서 재사용
  const SCORE_SHRINK_K = 8; // 판수 신뢰 계수 K: 2판→×0.2, 20판→×0.71, 50판→×0.86 (소표본 억제)
  const scoreOf = (games, wins, kda, avgDamage) => {
    if (!games) return 0;
    const adjWr = (wins + 2) / (games + 4);
    // KDA는 √(제곱근) 곡선 — 낮을 땐 쑥 오르고 높을수록 완만(오목). 직선 kda×10 대비 고KDA 캐리 억제.
    const raw = adjWr * 100 * 0.9 + Math.log(games) * 10 + Math.sqrt(kda || 0) * 12 + (avgDamage || 0) / 1000 * 0.4;
    // ⚠️ 소표본이 통계 1위 먹는 것 방지 — 라플라스는 승률항만 누르고 KDA는 못 눌러서, 스코어 전체에 판수 신뢰도 곱함.
    const conf = games / (games + SCORE_SHRINK_K);
    return Math.round(raw * conf * 10) / 10;
  };

  const rows = persons.map((p) => {
    const mine = parts.filter((x) => x.person_id === p.id);
    const games = mine.length;
    const wins = mine.filter((x) => x.win).length;
    const positions = { top: 0, jungle: 0, mid: 0, adc: 0, sup: 0 };
    const posWins = { top: 0, jungle: 0, mid: 0, adc: 0, sup: 0 };
    mine.forEach((m) => { const pos = posOf(m); if (pos && positions[pos] != null) { positions[pos]++; if (m.win) posWins[pos]++; } });
    const posSorted = Object.entries(positions).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const mainPos = posSorted.length ? posSorted[0][0] : null;
    const positionStats = {};
    Object.keys(positions).forEach((k) => { if (positions[k] > 0) positionStats[k] = { games: positions[k], wins: posWins[k], winrate: posWins[k] / positions[k] }; });
    const sg = mine.filter((m) => m.kills != null); // 상세통계 있는 경기
    const sum = (f) => sg.reduce((a, m) => a + (m[f] || 0), 0);
    const sk = sum('kills'), sd = sum('deaths'), sa = sum('assists');
    // 분당 CS: 게임시간 있는 경기만 (CS 합 / 시간 합)
    const csMinGames = sg.filter((m) => durById[m.match_id] > 0);
    const csMinCs = csMinGames.reduce((a, m) => a + (m.cs || 0), 0);
    const csMinDur = csMinGames.reduce((a, m) => a + durById[m.match_id], 0);
    const champ = {};
    sg.forEach((m) => { if (m.champion) champ[m.champion] = (champ[m.champion] || 0) + 1; });
    const topChamps = Object.entries(champ).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([c, n]) => ({ champion: c, games: n }));
    return {
      id: p.id, name: p.display_name, nickname: p.nickname || null, base_tier: p.base_tier, profile: p.profile || null,
      games, wins, losses: games - wins, winrate: games ? wins / games : 0,
      mvp: mvpCount[p.id] || 0, ace: aceCount[p.id] || 0,
      champPool: Object.keys(champ).length, // 챔프폭: 플레이한 고유 챔피언 수
      statGames: sg.length,
      totalK: sk, totalD: sd, totalA: sa, // 전체 합산 (1000킬 카운트용)
      kda: sg.length ? (sd ? Math.round(((sk + sa) / sd) * 100) / 100 : sk + sa) : null,
      kAvg: sg.length ? Math.round((sk / sg.length) * 10) / 10 : 0,
      dAvg: sg.length ? Math.round((sd / sg.length) * 10) / 10 : 0,
      aAvg: sg.length ? Math.round((sa / sg.length) * 10) / 10 : 0,
      avgCs: sg.length ? Math.round(sum('cs') / sg.length) : 0,
      csPerMin: csMinDur ? Math.round((csMinCs / csMinDur) * 10) / 10 : null,
      csMinGames: csMinGames.length,
      avgDamage: sg.length ? Math.round(sum('damage') / sg.length) : 0,
      avgGold: sg.length ? Math.round(sum('gold') / sg.length) : 0,
      topChamps, positions, mainPos, positionStats,
      autoAdj: autoAdjOf(p.base_tier, games, wins, p.id),
    };
  });
  // 내전 점수: 승률·판수가 핵심 + KDA·딜량 반영.
  //   = 보정승률(%)×0.9 + ln(판수)×10 + KDA×10 + 딜량(k)×0.4
  //   보정승률 = (승+2)/(판수+4) 라플라스 — 소표본 극단 승률(3승0패=100%)을 눌러 검증된 승률이 위로.
  //   ln(판수)×10: 승률 vs 판수 교환비. ×10이면 "100판짜리는 68% 넘어야 200판 60%를 이김".
  //     (×18은 커트라인 74.6%로 너무 높아 70승30패가 120승80패한테 밀렸음 → 10으로 완화)
  rows.forEach((r) => { r.score = scoreOf(r.games, r.wins, r.kda, r.avgDamage); });
  rows.sort((a, b) => (b.games ? b.score : -1) - (a.games ? a.score : -1));

  // ── 라인별 리더보드: 각 포지션에서 뛴 경기만 집계해 랭킹 ──
  const LANE_MIN = 2; // 라인별은 판수가 쪼개지니 2판 이상
  const laneAgg = {}; // `${personId}|${pos}` → 집계
  parts.forEach((m) => {
    const pos = posOf(m); if (!pos) return;
    const k = m.person_id + '|' + pos;
    const L = laneAgg[k] = laneAgg[k] || { games: 0, wins: 0, sk: 0, sd: 0, sa: 0, dmg: 0, sg: 0, champ: {} };
    L.games++; if (m.win) L.wins++;
    if (m.champion) L.champ[m.champion] = (L.champ[m.champion] || 0) + 1;
    if (m.kills != null) { L.sg++; L.sk += m.kills || 0; L.sd += m.deaths || 0; L.sa += m.assists || 0; L.dmg += m.damage || 0; }
  });
  const lanes = {};
  POS_KEYS.forEach((pos) => {
    const list = [];
    persons.forEach((p) => {
      const L = laneAgg[p.id + '|' + pos];
      if (!L || L.games < LANE_MIN) return;
      const kda = L.sg ? (L.sd ? Math.round(((L.sk + L.sa) / L.sd) * 100) / 100 : L.sk + L.sa) : null;
      const avgDamage = L.sg ? Math.round(L.dmg / L.sg) : 0;
      const topChamps = Object.entries(L.champ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => ({ champion: c, games: n }));
      list.push({
        id: p.id, name: p.display_name, nickname: p.nickname || null, base_tier: p.base_tier,
        games: L.games, wins: L.wins, losses: L.games - L.wins, winrate: L.games ? L.wins / L.games : 0,
        kda, avgDamage, topChamps,
        kAvg: L.sg ? Math.round((L.sk / L.sg) * 10) / 10 : 0,
        dAvg: L.sg ? Math.round((L.sd / L.sg) * 10) / 10 : 0,
        aAvg: L.sg ? Math.round((L.sa / L.sg) * 10) / 10 : 0,
        mvp: 0, ace: 0,
        score: scoreOf(L.games, L.wins, kda, avgDamage),
      });
    });
    list.sort((a, b) => b.score - a.score);
    lanes[pos] = list;
  });

  return { totalMatches: matchCount || 0, players: rows, lanes, laneMin: LANE_MIN, scoreFormula: '(보정승률×0.9 + ln(판수)×10 + √KDA×12 + 딜량(k)×0.4) × 판수신뢰도' };
}

// ── 칭호: 개인(승률·CS·MVP) + 관계형(듀오·상대전적·연승). 사람ID/이름별 뱃지 맵 포함 ──
export async function getAwards(groupId) {
  const { players } = await getStats(groupId); // 개인 지표(승률·csPerMin·mvp·ace)
  const nm = Object.fromEntries(players.map((p) => [p.id, p.nickname || p.name]));
  const { data: matches } = await db().from('matches')
    .select('id, winner, played_at').eq('group_id', groupId).order('played_at', { ascending: true });
  if (!matches?.length) return { byPerson: {}, byName: {} };
  const mids = matches.map((m) => m.id);
  const { data: parts } = await db().from('match_participants')
    .select('match_id, person_id, team').in('match_id', mids);
  const byMatch = {};
  (parts || []).forEach((p) => { (byMatch[p.match_id] = byMatch[p.match_id] || []).push(p); });

  const pGames = {}, pRes = {}; // 판수, 시간순 승패기록
  const duo = {}, h2h = {};     // 같은팀 페어 / 상대팀 페어
  const key = (x, y) => (x < y ? x + '|' + y : y + '|' + x);

  matches.forEach((m) => {
    const list = byMatch[m.id] || [];
    const team = { A: [], B: [] };
    list.forEach((p) => { if (team[p.team]) team[p.team].push(p.person_id); });
    list.forEach((p) => {
      pGames[p.person_id] = (pGames[p.person_id] || 0) + 1;
      (pRes[p.person_id] = pRes[p.person_id] || []).push(p.team === m.winner);
    });
    for (const t of ['A', 'B']) {
      const arr = team[t], won = m.winner === t;
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const k = key(arr[i], arr[j]);
        const d = (duo[k] = duo[k] || { games: 0, wins: 0 });
        d.games++; if (won) d.wins++;
      }
    }
    team.A.forEach((a) => team.B.forEach((b) => {
      const k = key(a, b), first = a < b ? a : b;
      const h = (h2h[k] = h2h[k] || { games: 0, firstWins: 0, first });
      h.games++;
      const winnerId = m.winner === 'A' ? a : b;
      if (winnerId === first) h.firstWins++;
    }));
  });

  const active = Object.keys(pGames).filter((id) => pGames[id] >= 3 && nm[id]);

  // 최고의 듀오: 같이 3판+ 중 승률 최고
  let bestDuo = null;
  for (const [k, d] of Object.entries(duo)) {
    if (d.games < 3) continue;
    const wr = d.wins / d.games;
    if (!bestDuo || wr > bestDuo.winrate || (wr === bestDuo.winrate && d.games > bestDuo.games)) {
      const [a, b] = k.split('|');
      bestDuo = { aId: a, bId: b, a: nm[a], b: nm[b], games: d.games, wins: d.wins, winrate: wr };
    }
  }

  // 견우와 직녀: 활동 선수 중 같은 팀으로 가장 적게 만난 두 명 (0판=한 번도 안 만남)
  let starCrossed = null;
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    const together = duo[key(a, b)]?.games || 0;
    const apart = pGames[a] + pGames[b];
    if (!starCrossed || together < starCrossed.together || (together === starCrossed.together && apart > starCrossed.apart))
      starCrossed = { aId: a, bId: b, a: nm[a], b: nm[b], together, apart };
  }

  // 인간상성: 상대팀으로 3판+ 만난 페어 중 한쪽이 가장 압도적
  let nemesis = null;
  for (const [k, h] of Object.entries(h2h)) {
    if (h.games < 3) continue;
    const [a, b] = k.split('|');
    const firstWins = h.firstWins, secondWins = h.games - h.firstWins;
    const domWins = Math.max(firstWins, secondWins), dom = domWins / h.games;
    if (!nemesis || dom > nemesis.dom || (dom === nemesis.dom && h.games > nemesis.games)) {
      const winner = firstWins >= secondWins ? a : b, loser = firstWins >= secondWins ? b : a;
      nemesis = { winnerId: winner, loserId: loser, winner: nm[winner], loser: nm[loser], wins: domWins, losses: h.games - domWins, games: h.games, dom };
    }
  }

  // 연승중 / 연패중: 최근 경기부터 연속 (2연속+). 개인별 streakById + 패널용 top-1.
  const streak = (arr, want) => { let s = 0; for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] === want) s++; else break; } return s; };
  const streakById = {};
  let winStreak = null, loseStreak = null;
  for (const id of Object.keys(pRes)) {
    if (!nm[id]) continue;
    const w = streak(pRes[id], true), l = streak(pRes[id], false);
    streakById[id] = { w, l };
    if (w >= 2 && (!winStreak || w > winStreak.streak)) winStreak = { id, name: nm[id], streak: w };
    if (l >= 2 && (!loseStreak || l > loseStreak.streak)) loseStreak = { id, name: nm[id], streak: l };
  }

  // 개인 칭호 (getStats players 기반)
  const played = players.filter((p) => p.games > 0);
  const maxBy = (pool, k) => pool.reduce((b, p) => (!b || (p[k] || 0) > (b[k] || 0) ? p : b), null);
  const wrPool = played.filter((p) => p.games >= 3);
  const pool = wrPool.length ? wrPool : played;
  // 공공의적: 라플라스 보정 승률(가상 2승2패). 판수 적으면 50%로 수렴 →
  // 6승1패(0.78) > 3승0패(0.71). 판수·승률·승/패 횟수를 한 값으로 자연스레 합침.
  const ADJ = 2;
  const adjWr = (p) => (p.wins + ADJ) / (p.games + ADJ * 2);
  // 공공의적: 보정 승률 최고, 동률이면 판수 많은 쪽 → 실제 승률
  const peP = played.reduce((b, p) => {
    if (!b) return p;
    const a = adjWr(p), c = adjWr(b);
    if (a !== c) return a > c ? p : b;
    if (p.games !== b.games) return p.games > b.games ? p : b;
    return p.winrate > b.winrate ? p : b;
  }, null);
  // 개인 칭호도 3판 이상(pool)만 대상 — 1~2판 반짝 1등 방지. 고인물(판수)만 전체 대상.
  const farmP = maxBy(pool.filter((p) => p.csPerMin != null), 'csPerMin');
  const mvpP = maxBy(pool.filter((p) => p.mvp > 0), 'mvp');
  const aceP = maxBy(pool.filter((p) => p.ace > 0), 'ace');
  const carryP = maxBy(pool.filter((p) => p.avgDamage > 0), 'avgDamage');
  const addictP = maxBy(played, 'games');
  const killerP = maxBy(pool.filter((p) => (p.totalK || 0) > 0), 'totalK');   // 킬러: 누적 킬 1등
  const corpseP = maxBy(pool.filter((p) => (p.totalD || 0) > 0), 'totalD');   // 시체: 누적 데스 1등
  const toolP = maxBy(pool.filter((p) => (p.totalA || 0) > 0), 'totalA');     // 도구: 누적 어시 1등
  const publicEnemy = peP && peP.games ? { id: peP.id, name: nm[peP.id], winrate: peP.winrate, wins: peP.wins, losses: peP.losses } : null;
  const killer = killerP ? { id: killerP.id, name: nm[killerP.id], totalK: killerP.totalK } : null;
  const corpse = corpseP ? { id: corpseP.id, name: nm[corpseP.id], totalD: corpseP.totalD } : null;
  const tool = toolP ? { id: toolP.id, name: nm[toolP.id], totalA: toolP.totalA } : null;
  const carryKing = carryP ? { id: carryP.id, name: nm[carryP.id], avgDamage: carryP.avgDamage } : null;
  const gameAddict = addictP && addictP.games ? { id: addictP.id, name: nm[addictP.id], games: addictP.games } : null;
  const farmKing = farmP ? { id: farmP.id, name: nm[farmP.id], csPerMin: farmP.csPerMin } : null;
  const mvpKing = mvpP ? { id: mvpP.id, name: nm[mvpP.id], mvp: mvpP.mvp } : null;
  const aceKing = aceP ? { id: aceP.id, name: nm[aceP.id], ace: aceP.ace } : null;

  // 사람ID / 이름(정규화) → 칭호 뱃지 목록
  const byPerson = {}, byName = {};
  const normName = (s) => stripInvisible(s || '').toLowerCase().replace(/\s+/g, '');
  const nickById = Object.fromEntries(players.map((p) => [p.id, { name: p.name, nickname: p.nickname }]));
  const add = (id, ic, title, label) => {
    if (!id) return;
    const badge = label != null ? { ic, title, label } : { ic, title };
    (byPerson[id] = byPerson[id] || []).push(badge);
    const info = nickById[id]; if (!info) return;
    [info.name, info.nickname].filter(Boolean).forEach((s) => {
      const k = normName(s); if (k) (byName[k] = byName[k] || []).push(badge);
    });
  };
  // 개인 칭호 (항상 표시). 관계형(듀오·견우직녀·인간상성)은 밸런서에서 팀구성별로 표시하므로 여기선 제외.
  add(publicEnemy?.id, '🏆', '공공의적');
  add(carryKing?.id, '💥', '캐리왕');
  add(gameAddict?.id, '🎮', '고인물');
  add(farmKing?.id, '🌾', '농사왕');
  add(mvpKing?.id, '🏅', 'MVP왕');
  add(aceKing?.id, '⭐', 'ACE왕');
  add(killer?.id, '⚔️', '킬러');
  add(corpse?.id, '💀', '시체');
  add(tool?.id, '🔧', '도구');
  // 개인별 연승/연패 (1위뿐 아니라 각자) — 숫자까지 표시
  Object.entries(streakById).forEach(([id, s]) => {
    if (s.w >= 2) add(id, '🔥', `${s.w}연승 중`, s.w);
    else if (s.l >= 2) add(id, '🧊', `${s.l}연패 중`, s.l);
  });
  // 칭호왕: 지금까지 부여된 칭호(뱃지)를 가장 많이 가진 사람. 2개 이상일 때만 등장.
  let titleKing = null;
  Object.entries(byPerson).forEach(([id, badges]) => {
    if (!titleKing || badges.length > titleKing.count) titleKing = { id, name: nm[id], count: badges.length };
  });
  if (titleKing && titleKing.count >= 2) add(titleKing.id, '👑', '칭호왕', titleKing.count);
  else titleKing = null;

  return { publicEnemy, titleKing, carryKing, gameAddict, farmKing, mvpKing, aceKing, killer, corpse, tool, bestDuo, starCrossed, nemesis, winStreak, loseStreak, streakById, byPerson, byName };
}

// ── 경기 히스토리: 최근 경기별 풀 로스터 + MVP/ACE ──
export async function getMatchHistory(groupId, limit = 30) {
  // 리플 상세(objectives/source/duration) 포함 시도 → 컬럼 미반영이면 기본 필드로 폴백
  let matches;
  {
    const qy = (cols) => db().from('matches').select(cols).eq('group_id', groupId).order('played_at', { ascending: false }).limit(limit);
    let res = await qy('id, played_at, winner, objectives, source, duration_min, duration_sec');
    if (res.error && /duration_sec/i.test(res.error.message || '')) res = await qy('id, played_at, winner, objectives, source, duration_min'); // sec 컬럼 미반영
    if (res.error && /(objectives|source|duration_min)/i.test(res.error.message || '')) res = await qy('id, played_at, winner');
    if (res.error) throw res.error; matches = res.data;
  }
  if (!matches || !matches.length) return { matches: [] };
  const mids = matches.map((m) => m.id);
  // slot(스샷 행 순서) 기준 정렬 → 스크린샷 순서 그대로 표시. 컬럼 없으면 정렬 없이 폴백.
  let parts;
  {
    const res = await db().from('match_participants').select('*').in('match_id', mids)
      .order('slot', { ascending: true, nullsFirst: false });
    if (res.error && /slot/i.test(res.error.message || '')) {
      parts = (await db().from('match_participants').select('*').in('match_id', mids)).data;
    } else parts = res.data;
  }
  const persons = await listPersons(groupId);
  const nameById = Object.fromEntries(persons.map((p) => [p.id, p.nickname || p.display_name]));
  const personById = Object.fromEntries(persons.map((p) => [p.id, p]));
  // 뛴 포지션 기준 유효 티어: 그 포지션이 '부포지션'이면 부라인티어, 아니면 메인티어 (밸런서 effTier와 동일)
  const effTierOf = (pid, pos) => {
    const p = personById[pid]; if (!p) return null;
    if (pos && p.secondary_tier && (p.secondary_positions || []).includes(pos) && !(p.primary_positions || []).includes(pos)) return p.secondary_tier;
    return p.base_tier || null;
  };
  const econ = (m) => m.gold || m.cs || 0; // 골드/CS 토글 대응 — 있는 쪽 사용
  const opScore = (m, tK, tD, tG) => {
    // 통계 MVP와 동일 공식 (KDA 상한 10 + 딜·KP 비중 상향)
    const kda = Math.min((m.kills + (m.assists || 0)) / Math.max(1, m.deaths || 0), 10);
    const kp = (m.kills + (m.assists || 0)) / Math.max(1, tK);
    return kda * 0.6 + kp * 5 + (m.damage || 0) / Math.max(1, tD) * 22.5 + econ(m) / Math.max(1, tG) * 3 - (m.deaths || 0) * 0.5;
  };
  const out = matches.map((match) => {
    const ps = (parts || []).filter((x) => x.match_id === match.id);
    const tot = { A: { k: 0, d: 0, g: 0, cs: 0 }, B: { k: 0, d: 0, g: 0, cs: 0 } };
    ps.forEach((x) => { const t = tot[x.team]; if (t) { t.k += x.kills || 0; t.d += x.damage || 0; t.g += econ(x); t.cs += x.cs || 0; } });
    const scored = ps.map((x) => ({ x, s: x.kills != null ? opScore(x, tot[x.team].k, tot[x.team].d, tot[x.team].g) : -1 }));
    const win = match.winner;
    const top = (arr) => arr.reduce((b, z) => (!b || z.s > b.s ? z : b), null);
    const mvpId = top(scored.filter((z) => z.x.team === win))?.x.id;
    const aceId = top(scored.filter((z) => z.x.team !== win))?.x.id;
    // 경기 내 등수 (opScore 높은 순 1~10) + 각자 점수
    const rankById = {}, scoreById = {};
    scored.forEach((z) => { scoreById[z.x.id] = z.s; });
    [...scored].sort((a, b) => b.s - a.s).forEach((z, i) => { rankById[z.x.id] = i + 1; });
    const row = (x) => ({ personId: x.person_id, name: nameById[x.person_id] || '?', champion: x.champion,
      tier: effTierOf(x.person_id, x.position), // 뛴 포지션 기준 티어 (부라인이면 부라인티어)
      k: x.kills, d: x.deaths, a: x.assists, cs: x.cs, damage: x.damage, gold: x.gold, position: x.position,
      detail: x.detail || null, // 리플 상세(아이템·비전 등) — 있을 때만
      mvp: x.id === mvpId, ace: x.id === aceId, rank: rankById[x.id],
      score: Math.round((scoreById[x.id] || 0) * 10) / 10 });
    return {
      id: match.id, played_at: match.played_at, winner: win, mvpScore: mvpId ? Math.round((scoreById[mvpId] || 0) * 10) / 10 : 0,
      objectives: match.objectives || null, source: match.source || null, durationMin: match.duration_min || null,
      durationSec: match.duration_sec ?? (match.duration_min != null ? match.duration_min * 60 : null),
      A: ps.filter((x) => x.team === 'A').map(row), B: ps.filter((x) => x.team === 'B').map(row),
      killsA: tot.A.k, killsB: tot.B.k, csA: tot.A.cs, csB: tot.B.cs, goldA: tot.A.g, goldB: tot.B.g,
    };
  });
  // 완전 캐리 무지개 기준: 기록된 MVP 점수들 중 '많이 높은' 축(상위 15% 지점). 표본 적으면 절대값 20.
  const mvpScores = out.map((m) => m.mvpScore).filter((s) => s > 0).sort((a, b) => a - b);
  const carryThreshold = mvpScores.length >= 6 ? mvpScores[Math.floor(mvpScores.length * 0.85)] : 20;
  return { matches: out, carryThreshold };
}

// ── 챔피언 통계 (그룹 전체): 픽수·승률·평균 KDA ──
export async function getChampionStats(groupId) {
  const persons = await listPersons(groupId);
  const ids = persons.map((p) => p.id);
  if (!ids.length) return { champions: [] };
  const { data, error } = await db().from('match_participants').select('*').in('person_id', ids);
  if (error) throw error;
  const by = {};
  (data || []).forEach((m) => {
    if (!m.champion) return;
    const c = (by[m.champion] = by[m.champion] || { champion: m.champion, games: 0, wins: 0, k: 0, d: 0, a: 0, dmg: 0 });
    c.games++; if (m.win) c.wins++;
    c.k += m.kills || 0; c.d += m.deaths || 0; c.a += m.assists || 0; c.dmg += m.damage || 0;
  });
  const champions = Object.values(by).map((c) => ({
    champion: c.champion, games: c.games, wins: c.wins, winrate: c.games ? c.wins / c.games : 0,
    kda: c.d ? Math.round(((c.k + c.a) / c.d) * 100) / 100 : c.k + c.a,
    avgDamage: Math.round(c.dmg / c.games),
  })).sort((a, b) => b.games - a.games || b.winrate - a.winrate);
  return { champions };
}

// ── 선수 1명 상세: 챔피언별 + 최근 경기 + 듀오 + 기록 ──
export async function getPlayerDetail(groupId, personId) {
  const { data: parts, error } = await db().from('match_participants').select('*').eq('person_id', personId);
  if (error) throw error;
  const mids = [...new Set((parts || []).map((p) => p.match_id))];
  let matches = [];
  if (mids.length) {
    let mres = await db().from('matches').select('id, played_at, winner, duration_sec, duration_min').in('id', mids);
    if (mres.error) mres = await db().from('matches').select('id, played_at, winner, duration_min').in('id', mids);
    matches = mres.data || [];
  }
  const mById = Object.fromEntries(matches.map((m) => [m.id, m]));
  const durById = Object.fromEntries(matches.map((m) => [m.id, m.duration_sec ?? (m.duration_min ? m.duration_min * 60 : 0)]));

  // 듀오: 같은 경기 같은 팀 동료들의 함께 승률
  const persons = await listPersons(groupId);
  const nameById = Object.fromEntries(persons.map((p) => [p.id, p.nickname || p.display_name]));
  let allInMatches = [];
  if (mids.length) {
    let r = await db().from('match_participants').select('match_id, person_id, team, win, position, slot').in('match_id', mids);
    if (r.error) r = await db().from('match_participants').select('match_id, person_id, team, win').in('match_id', mids);
    allInMatches = r.data || [];
  }
  const myTeam = {}; // match_id → {team, win}
  (parts || []).forEach((m) => { myTeam[m.match_id] = { team: m.team, win: m.win }; });
  const duo = {};
  allInMatches.forEach((m) => {
    const mine = myTeam[m.match_id];
    if (!mine || m.person_id === personId || m.team !== mine.team) return;
    const d = (duo[m.person_id] = duo[m.person_id] || { id: m.person_id, games: 0, wins: 0 });
    d.games++; if (mine.win) d.wins++;
  });
  const duos = Object.values(duo).filter((d) => d.games >= 2)
    .map((d) => ({ name: nameById[d.id] || '?', games: d.games, winrate: d.wins / d.games }))
    .sort((a, b) => b.winrate - a.winrate || b.games - a.games);
  const best = duos.slice(0, 3);
  const worst = duos.length > 3 ? duos.slice(-2).reverse() : [];

  // 맞라인: 각 경기에서 같은 포지션(position 우선, 없으면 slot%5)의 상대팀 선수와의 전적
  const LP = ['top', 'jungle', 'mid', 'adc', 'sup'];
  const posOfPart = (m) => (m.position && LP.includes(m.position) ? m.position : (m.slot != null ? LP[((m.slot % 5) + 5) % 5] : null));
  const myPosBy = {}; // match_id → 내 포지션
  (parts || []).forEach((m) => { myPosBy[m.match_id] = posOfPart(m); });
  const lane = {}; // 상대 person_id → { games, wins, pos }
  allInMatches.forEach((m) => {
    const mine = myTeam[m.match_id];
    if (!mine || m.person_id === personId || m.team === mine.team) return; // 상대팀만
    const myPos = myPosBy[m.match_id];
    if (!myPos || posOfPart(m) !== myPos) return;                          // 같은 라인만
    const l = (lane[m.person_id] = lane[m.person_id] || { id: m.person_id, games: 0, wins: 0, pos: myPos });
    l.games++; if (mine.win) l.wins++;
  });
  const laneMatchups = Object.values(lane)
    .map((d) => ({ name: nameById[d.id] || '?', pos: d.pos, games: d.games, wins: d.wins, winrate: d.wins / d.games }))
    .sort((a, b) => b.games - a.games || b.winrate - a.winrate);

  // 기록
  const sg = (parts || []).filter((m) => m.kills != null);
  const maxKill = sg.reduce((b, m) => (!b || (m.kills || 0) > b.kills ? { kills: m.kills, champion: m.champion } : b), null);
  const maxKda = sg.reduce((b, m) => {
    const v = (m.deaths ? (m.kills + m.assists) / m.deaths : m.kills + m.assists);
    return (!b || v > b.v ? { v: Math.round(v * 100) / 100, champion: m.champion } : b);
  }, null);
  // 챔피언별 상세 (딜·CS·골드/분, 멀티킬, 시야 — 리플 상세 수집분 활용)
  const by = {};
  (parts || []).forEach((m) => {
    if (!m.champion) return;
    const c = (by[m.champion] = by[m.champion] || { champion: m.champion, games: 0, wins: 0, k: 0, d: 0, a: 0, dmg: 0, cs: 0, gold: 0, sec: 0, vision: 0, wards: 0, mk: 0, penta: 0 });
    c.games++; if (m.win) c.wins++; c.k += m.kills || 0; c.d += m.deaths || 0; c.a += m.assists || 0;
    c.dmg += m.damage || 0; c.cs += m.cs || 0; c.gold += m.gold || 0; c.sec += durById[m.match_id] || 0;
    const det = m.detail || {};
    c.vision += det.visionScore || 0; c.wards += det.wardsPlaced || 0;
    c.mk += (det.double || 0) + (det.triple || 0) + (det.quadra || 0) + (det.penta || 0); c.penta += det.penta || 0;
  });
  const champions = Object.values(by).map((c) => {
    const min = c.sec / 60, g = c.games || 1;
    return {
      champion: c.champion, games: c.games, wins: c.wins, winrate: c.games ? c.wins / c.games : 0,
      k: c.k, d: c.d, a: c.a, // 챔프별 총 K/D/A
      avgK: Math.round(c.k / g * 10) / 10, avgD: Math.round(c.d / g * 10) / 10, avgA: Math.round(c.a / g * 10) / 10,
      kda: c.d ? Math.round(((c.k + c.a) / c.d) * 100) / 100 : c.k + c.a,
      avgDmg: Math.round(c.dmg / g), dmgPerMin: min ? Math.round(c.dmg / min) : 0,
      avgCs: Math.round(c.cs / g), csPerMin: min ? Math.round((c.cs / min) * 10) / 10 : 0,
      avgGold: Math.round(c.gold / g), goldPerMin: min ? Math.round(c.gold / min) : 0,
      avgVision: Math.round((c.vision / g) * 10) / 10, avgWards: Math.round((c.wards / g) * 10) / 10,
      multikills: c.mk, pentas: c.penta, hasDetail: c.sec > 0 || c.vision > 0 || c.dmg > 0,
    };
  }).sort((a, b) => b.games - a.games || b.winrate - a.winrate || b.kda - a.kda); // 판수 → 승률 → KDA 우선
  // 전체 전적 (played_at 내림차순) — 커스텀게임 개인 전적
  const history = (parts || [])
    .map((m) => ({ champion: m.champion, k: m.kills, d: m.deaths, a: m.assists, win: m.win, cs: m.cs, damage: m.damage, played_at: mById[m.match_id]?.played_at }))
    .sort((a, b) => new Date(b.played_at || 0) - new Date(a.played_at || 0));
  const recent = history.slice(0, 12);
  return { champions, recent, history, best, worst, laneMatchups, records: { maxKill, maxKda } };
}
