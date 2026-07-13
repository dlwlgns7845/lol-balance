import { NextResponse } from 'next/server';
import { listTournamentMembers, setTournamentMemberRole } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, requireTournamentHost, errStatus } from '../../../../../src/auth.js';

// 멤버 목록 (운영자 — 대회장·공동운영)
export async function GET(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    return NextResponse.json({ ok: true, members: await listTournamentMembers(params.id) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 공동운영 지정/해제 (대회장 전용). body: { user_id, role: 'admin'|'viewer' }
export async function POST(request, { params }) {
  try {
    await requireTournamentHost(request, params.id);
    const { user_id, role } = await request.json();
    await setTournamentMemberRole(params.id, user_id, role);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
