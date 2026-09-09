import { NextResponse } from 'next/server';
import { setWinAdjEnabled } from '../../../src/repo.js';
import { getUser, getRole, isAdmin, errStatus } from '../../../src/auth.js';

// 승률 보정(티어보정) on/off — 방장 또는 관리자만. (현재값은 group.winadj_enabled로 내려감)
export async function POST(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    if (!gid) throw new Error('gid 필요');
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    const role = await getRole(gid, user.id);
    if (!isAdmin(user) && role !== 'owner') {
      return NextResponse.json({ ok: false, error: '방장만 바꿀 수 있어요' }, { status: 403 });
    }
    const { enabled } = await request.json();
    await setWinAdjEnabled(gid, enabled);
    return NextResponse.json({ ok: true, enabled: !!enabled });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
