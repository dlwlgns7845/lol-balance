import { NextResponse } from 'next/server';
import { deleteGroup } from '../../../../src/repo.js';
import { requireOwner, errStatus } from '../../../../src/auth.js';

// 방 삭제 — 방장만. body: { gid }
export async function POST(request) {
  try {
    const { gid } = await request.json();
    if (!gid) throw new Error('gid 필요');
    await requireOwner(request, gid);
    await deleteGroup(gid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
