import { NextResponse } from 'next/server';
import { generateBracket, reportMatch, setMatchSchedule, cancelBracket } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, getUser, errStatus } from '../../../../../src/auth.js';

// 대진 생성 (대회 운영자)
export async function POST(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    return NextResponse.json({ ok: true, ...(await generateBracket(params.id)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 경기 결과 입력. 일정=운영자. 결과=운영자 즉시확정 or 팀 주장 양측확인.
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    if (body.action === 'schedule') {
      await requireTournamentOwner(request, params.id); // 일정은 운영자만
      return NextResponse.json({ ok: true, ...(await setMatchSchedule(params.id, body.matchId, body.scheduledAt)) });
    }
    // 결과 보고: 운영자면 즉시확정, 아니면 주장 양측확인
    const user = await getUser(request);
    let isOwner = false;
    try { await requireTournamentOwner(request, params.id); isOwner = true; } catch { /* 운영자 아님 → 주장 경로 */ }
    return NextResponse.json({ ok: true, ...(await reportMatch(body.matchId, body, { user, isOwner })) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 🔄 대진 취소 (진행중 → 모집중, 대진만 삭제) — 대회 운영자
export async function DELETE(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    return NextResponse.json({ ok: true, ...(await cancelBracket(params.id)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
