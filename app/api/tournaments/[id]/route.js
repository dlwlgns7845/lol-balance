import { NextResponse } from 'next/server';
import { getTournament, updateTournament, registerTournamentMember, tournamentRole } from '../../../../src/repo-tournament.js';
import { requireTournamentOwner, getUser, isAdmin, errStatus } from '../../../../src/auth.js';

// 대회 열람 — 비로그인 가능. 로그인 유저는 자동 멤버 등록 + 내 역할 반환.
export async function GET(request, { params }) {
  try {
    const data = await getTournament(params.id);
    if (!data) return NextResponse.json({ ok: false, error: '대회를 찾을 수 없어요' }, { status: 404 });
    const user = await getUser(request);
    let myRole = null;
    if (user) { await registerTournamentMember(params.id, user); myRole = isAdmin(user) ? 'admin' : await tournamentRole(params.id, user.id); }
    return NextResponse.json({ ok: true, ...data, myRole });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

// 공지·이름·상태 수정 (대회 운영자)
export async function PATCH(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    const body = await request.json();
    await updateTournament(params.id, body);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
