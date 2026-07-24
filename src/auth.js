// 서버 인증·권한 헬퍼. Authorization: Bearer <supabase access token> 검증 → 역할 확인.
import { db } from './supabase.js';

// 요청의 Bearer 토큰 → 유저 객체 | null (비로그인)
export async function getUser(request) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const { data, error } = await db().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user; // { id, email, user_metadata: { full_name, name, avatar_url } }
  } catch { return null; }
}

export function userName(user) {
  return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '사용자';
}

// Supabase user → 디스코드 유저ID(스노플레이크) | null. 계정 병합돼도 identity에서 직접.
export function discordIdOf(user) {
  if (!user) return null;
  const di = (user.identities || []).find((i) => i.provider === 'discord');
  const d = di?.identity_data || {};
  const id = di?.id || d.provider_id || d.sub;
  if (id) return String(id);
  const md = user.user_metadata || {};
  if (md.provider === 'discord' && (md.provider_id || md.sub)) return String(md.provider_id || md.sub);
  return null;
}

// 전역 관리자 (모든 방·대회 열람·관리 가능)
export const ADMIN_EMAILS = ['dlwlgns714@gmail.com', 'fbwlgkr7845@gmail.com'];
// 디코ID 기준 관리자 (이메일 병합 안 된 계정 대비). 필요 시 스노플레이크 추가.
export const ADMIN_DISCORD_IDS = [];
export function isAdmin(user) {
  if (!user) return false;
  if (ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return true;
  const did = discordIdOf(user);
  return !!did && ADMIN_DISCORD_IDS.includes(did);
}
export async function requireAdmin(request) {
  const user = await getUser(request);
  if (!isAdmin(user)) { const e = new Error('관리자 전용'); e.status = 403; throw e; }
  return user;
}

// 그룹에서 이 유저의 역할 ('owner'|'editor'|'viewer'|null)
export async function getRole(groupId, userId) {
  if (!groupId || !userId) return null;
  const { data } = await db().from('room_members')
    .select('role').eq('group_id', groupId).eq('user_id', userId).maybeSingle();
  return data?.role || null;
}

async function groupOwnerId(groupId) {
  const { data } = await db().from('groups').select('owner_id').eq('id', groupId).maybeSingle();
  return data?.owner_id || null;
}

const httpErr = (msg, status) => { const e = new Error(msg); e.status = status; return e; };

// 편집 권한 확인. 레거시 방(owner_id null)은 권한 미설정 → 누구나 허용(기존 동작 유지).
// owner가 지정된 방은 owner/editor만 허용.
export async function requireEditor(request, groupId) {
  const user = await getUser(request);
  if (isAdmin(user)) return { user, role: 'admin' }; // 관리자는 모든 방 편집 가능
  const owner = await groupOwnerId(groupId);
  if (!owner) return { user, role: 'editor', legacy: true };
  if (!user) throw httpErr('로그인이 필요합니다', 401);
  const role = await getRole(groupId, user.id);
  if (role !== 'owner' && role !== 'editor') throw httpErr('편집 권한이 없어요 — 방장에게 요청하세요', 403);
  return { user, role };
}

// 기록 권한 — owner/editor + recorder(기록 담당자). 멤버관리는 못 하고 리플/경기 기록만.
export async function requireRecorder(request, groupId) {
  const user = await getUser(request);
  if (isAdmin(user)) return { user, role: 'admin' };
  const owner = await groupOwnerId(groupId);
  if (!owner) return { user, role: 'editor', legacy: true };
  if (!user) throw httpErr('로그인이 필요합니다', 401);
  const role = await getRole(groupId, user.id);
  if (!['owner', 'editor', 'recorder'].includes(role)) throw httpErr('기록 권한이 없어요 — 방장에게 요청하세요', 403);
  return { user, role };
}

// 방장(또는 관리자) 전용
export async function requireOwner(request, groupId) {
  const user = await getUser(request);
  if (isAdmin(user)) return { user, role: 'admin' };
  if (!user) throw httpErr('로그인이 필요합니다', 401);
  const role = await getRole(groupId, user.id);
  if (role !== 'owner') throw httpErr('방장만 할 수 있어요', 403);
  return { user, role };
}

// 멸망전(대회) 운영자 — 대회장(owner_id) · 공동운영(멤버 role=admin) · 전역 관리자.
export async function requireTournamentOwner(request, tournamentId) {
  const user = await getUser(request);
  if (isAdmin(user)) return user;
  const { data } = await db().from('tournaments').select('owner_id').eq('id', tournamentId).maybeSingle();
  if (!data) throw httpErr('대회를 찾을 수 없어요', 404);
  if (!user) throw httpErr('로그인이 필요합니다', 401);
  if (user.id === data.owner_id) return user;
  const { data: mem } = await db().from('tournament_members').select('role').eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle();
  if (mem?.role === 'admin') return user; // 대회장이 지정한 공동운영자
  throw httpErr('대회 운영자만 할 수 있어요', 403);
}

// 대회장 본인 전용 (공동운영 관리 등) — 전역 관리자 포함.
export async function requireTournamentHost(request, tournamentId) {
  const user = await getUser(request);
  if (isAdmin(user)) return user;
  const { data } = await db().from('tournaments').select('owner_id').eq('id', tournamentId).maybeSingle();
  if (!data) throw httpErr('대회를 찾을 수 없어요', 404);
  if (!user) throw httpErr('로그인이 필요합니다', 401);
  if (user.id !== data.owner_id) throw httpErr('대회장만 할 수 있어요', 403);
  return user;
}

// 라우트에서 status 코드 있는 에러를 JSON 응답으로
export function errStatus(e) { return e?.status || 500; }
