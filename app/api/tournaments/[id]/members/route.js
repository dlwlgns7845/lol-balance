import { NextResponse } from 'next/server';
import { listTournamentMembers, setTournamentMemberRole, listKnownUsers } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, requireTournamentHost, errStatus } from '../../../../../src/auth.js';

// 멤버 목록 + 지정 후보(로그인 유저) — 운영자 열람. 후보는 대회장이 공동운영자로 지정할 대상.
export async function GET(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    const [members, candidates] = await Promise.all([listTournamentMembers(params.id), listKnownUsers()]);
    return NextResponse.json({ ok: true, members, candidates });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 공동운영 지정/해제 (대회장 전용). body: { user_id, role, name?, email? }
export async function POST(request, { params }) {
  try {
    await requireTournamentHost(request, params.id);
    const { user_id, role, name, email } = await request.json();
    await setTournamentMemberRole(params.id, user_id, role, { name, email });
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
