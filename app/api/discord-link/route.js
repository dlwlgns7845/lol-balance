// 디스코드 서버 연결 승인 (방장 또는 전역 관리자). GET=대기·승인 목록, POST=승인/거절.
import { NextResponse } from 'next/server';
import { requireOwner, errStatus } from '../../../src/auth.js';
import { listPendingLinks, getApprovedGuilds, approveGuildLink, removeGuildLink } from '../../../src/repo.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    if (!gid) throw new Error('gid 필요');
    await requireOwner(request, gid);
    return NextResponse.json({ ok: true, pending: await listPendingLinks(gid), approved: await getApprovedGuilds(gid) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

export async function POST(request) {
  try {
    const { gid, action, guildId } = await request.json();
    if (!gid || !guildId) throw new Error('gid·guildId 필요');
    await requireOwner(request, gid);
    if (action === 'approve') await approveGuildLink(gid, guildId);
    else if (action === 'reject') await removeGuildLink(guildId);
    else throw new Error('알 수 없는 액션');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
