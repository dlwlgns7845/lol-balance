import { NextResponse } from 'next/server';
import { isOptedOut, setDirectoryOptout } from '../../../src/repo.js';
import { getUser, errStatus } from '../../../src/auth.js';

// 내 명단 옵트아웃 상태 조회
export async function GET(request) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    return NextResponse.json({ ok: true, optedOut: await isOptedOut(user.id) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 내 명단 옵트아웃 설정/해제 (본인만)
export async function POST(request) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    const { hidden } = await request.json();
    await setDirectoryOptout(user.id, !!hidden);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
