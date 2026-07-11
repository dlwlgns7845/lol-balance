import { NextResponse } from 'next/server';
import { applyTeam, setTeamStatus, deleteTeam } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, errStatus } from '../../../../../src/auth.js';

// 팀 신청 (공개 — 누구나 신청, 운영자가 승인)
export async function POST(request, { params }) {
  try {
    const body = await request.json();
    return NextResponse.json({ ok: true, team: await applyTeam(params.id, body) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

// 승인/거절/삭제 (대회 운영자)
export async function PATCH(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    const body = await request.json();
    if (body.action === 'delete') await deleteTeam(body.teamId);
    else await setTeamStatus(body.teamId, body.status);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
