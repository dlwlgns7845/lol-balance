import { NextResponse } from 'next/server';
import { createGroup } from '../../../src/repo.js';
import { getUser, userName, errStatus } from '../../../src/auth.js';
import { hitLimit } from '../../../src/ratelimit.js';

export async function POST(request) {
  try {
    await hitLimit(request, 'group-create', 10, 3600); // 방 생성: IP당 시간당 10개
    const { code, name } = await request.json();
    const c = (code || '').trim().toLowerCase();
    if (!c) throw new Error('코드가 필요합니다');
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '방을 만들려면 로그인하세요' }, { status: 401 });
    const owner = { id: user.id, email: user.email, name: userName(user) };
    const group = await createGroup(c, (name || '').trim(), owner);
    return NextResponse.json({ ok: true, group, role: 'owner', canEdit: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status ? errStatus(e) : 400 });
  }
}
