import { NextResponse } from 'next/server';
import { deleteMyTraces } from '../../../src/repo.js';
import { getUser, errStatus } from '../../../src/auth.js';

// 내 로그인 흔적(관람 기록) 삭제 (본인만). 다시 로그인/입장하면 정상 재등록.
export async function POST(request) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    await deleteMyTraces(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
