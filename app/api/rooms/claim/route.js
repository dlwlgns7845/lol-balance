import { NextResponse } from 'next/server';
import { claimOwnership } from '../../../../src/repo.js';
import { getUser, userName, errStatus } from '../../../../src/auth.js';

// 레거시(주인 없는) 방을 로그인 유저가 방장으로 claim. body: { gid }
export async function POST(request) {
  try {
    const { gid } = await request.json();
    if (!gid) throw new Error('gid 필요');
    const user = await getUser(request);
    if (!user) { const e = new Error('로그인이 필요합니다'); e.status = 401; throw e; }
    const group = await claimOwnership(gid, { id: user.id, email: user.email, name: userName(user) });
    return NextResponse.json({ ok: true, group, role: 'owner', canEdit: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
