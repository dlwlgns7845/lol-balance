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

// 전역 관리자 (모든 방 열람·관리 가능)
export const ADMIN_EMAILS = ['dlwlgns714@gmail.com', 'fbwlgkr7845@gmail.com'];
export function isAdmin(user) {
  return !!user && ADMIN_EMAILS.includes((user.email || '').toLowerCase());
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

// 방장(또는 관리자) 전용
export async function requireOwner(request, groupId) {
  const user = await getUser(request);
  if (isAdmin(user)) return { user, role: 'admin' };
  if (!user) throw httpErr('로그인이 필요합니다', 401);
  const role = await getRole(groupId, user.id);
  if (role !== 'owner') throw httpErr('방장만 할 수 있어요', 403);
  return { user, role };
}

// 라우트에서 status 코드 있는 에러를 JSON 응답으로
export function errStatus(e) { return e?.status || 500; }
