import { NextResponse } from 'next/server';
import { getGroupByCode, registerMembership } from '../../../../src/repo.js';
import { getUser, getRole, userName, isAdmin, errStatus } from '../../../../src/auth.js';
import { checkLimit, recordFail } from '../../../../src/ratelimit.js';

export async function GET(request, { params }) {
  try {
    // 방코드 브루트포스 차단: "없는 코드" 시도만 카운트 (IP당 10분에 10회). 맞는 코드 입장은 무제한.
    await checkLimit(request, 'room-miss', 10, 600);
    const group = await getGroupByCode(decodeURIComponent(params.code).toLowerCase());
    if (!group) {
      await recordFail(request, 'room-miss', 600);
      return NextResponse.json({ ok: false, error: '없는 방 코드입니다' }, { status: 404 });
    }

    const user = await getUser(request);
    let role = null;
    if (user) {
      // 로그인 유저가 방에 들어옴 → 멤버로 등록(없으면 viewer). 방장에게 보이게.
      // room_members 스키마 미반영 등으로 실패해도 입장은 막지 않음(레거시 오픈).
      try {
        await registerMembership(group.id, { id: user.id, email: user.email, name: userName(user) });
        role = await getRole(group.id, user.id);
      } catch { role = null; }
    }
    // 관리자면 무조건 편집 가능. 그 외: 레거시(주인 없는) 방은 누구나, 주인 있으면 역할대로.
    const admin = isAdmin(user);
    const canEdit = admin || !group.owner_id || role === 'owner' || role === 'editor';
    const canRecord = canEdit || role === 'recorder'; // 기록 담당자는 기록만 가능(멤버관리 X)
    return NextResponse.json({ ok: true, group, role: admin ? 'admin' : role, canEdit, canRecord, ownerless: !group.owner_id, admin });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
