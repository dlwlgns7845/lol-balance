import { NextResponse } from 'next/server';
import { applyTeam, setTeamStatus, deleteTeam, withdrawTeam, setTeamCheckin, announceCheckin } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, getUser, errStatus } from '../../../../../src/auth.js';

// 팀 신청 (공개 — 누구나 신청, 운영자가 승인). 로그인했으면 신청자를 주장으로 바인딩.
export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const user = await getUser(request); // 있으면 captain_user_id로 묶임(익명도 허용)
    return NextResponse.json({ ok: true, team: await applyTeam(params.id, body, user) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

// 승인/거절/삭제 (대회 운영자) · 신청취소(withdraw = 주장 본인, 운영자 아님)
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    if (body.action === 'withdraw') { // 주장 셀프서비스 — 운영자 권한 불필요
      const user = await getUser(request);
      await withdrawTeam(body.teamId, user);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'checkin') { // 체크인 — 주장 본인 또는 운영자
      const user = await getUser(request);
      let isOwner = false;
      try { await requireTournamentOwner(request, params.id); isOwner = true; } catch { /* 주장 경로 */ }
      return NextResponse.json({ ok: true, ...(await setTeamCheckin(body.teamId, body.value, { user, isOwner })) });
    }
    await requireTournamentOwner(request, params.id);
    if (body.action === 'checkin-remind') return NextResponse.json({ ok: true, sent: await announceCheckin(params.id) });
    if (body.action === 'delete') await deleteTeam(body.teamId);
    else await setTeamStatus(body.teamId, body.status);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
