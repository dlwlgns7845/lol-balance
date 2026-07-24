import { NextResponse } from 'next/server';
import { listMembers, setMemberRole, removeMember, getGroupById } from '../../../src/repo.js';
import { getUser, getRole, isAdmin, requireOwner, errStatus } from '../../../src/auth.js';

// 방 멤버 목록 + 내 역할. 그 방의 멤버(로그인)만 — 이메일(PII)은 방장·관리자에게만.
export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    if (!gid) throw new Error('gid 필요');
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    const admin = isAdmin(user);
    const myRole = await getRole(gid, user.id);
    if (!admin && !myRole) return NextResponse.json({ ok: false, error: '이 방의 멤버만 볼 수 있어요' }, { status: 403 });
    const group = await getGroupById(gid);
    let members = await listMembers(gid);
    if (!admin && myRole !== 'owner') members = members.map((m) => ({ ...m, email: null }));
    return NextResponse.json({ ok: true, members, myRole: admin ? 'admin' : myRole, ownerId: group?.owner_id || null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

// 방장이 멤버 역할 변경. body: { gid, user_id, role: 'editor'|'viewer' }
export async function POST(request) {
  try {
    const { gid, user_id, role } = await request.json();
    if (!gid || !user_id) throw new Error('gid·user_id 필요');
    await requireOwner(request, gid);
    await setMemberRole(gid, user_id, role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

// 방장이 멤버를 방에서 내보냄. body: { gid, user_id }
export async function DELETE(request) {
  try {
    const { gid, user_id } = await request.json();
    if (!gid || !user_id) throw new Error('gid·user_id 필요');
    await requireOwner(request, gid);
    await removeMember(gid, user_id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
