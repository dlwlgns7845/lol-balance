import { NextResponse } from 'next/server';
import { generateBracket, reportMatch, setMatchSchedule, cancelBracket } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, errStatus } from '../../../../../src/auth.js';

// 대진 생성 (대회 운영자)
export async function POST(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    return NextResponse.json({ ok: true, ...(await generateBracket(params.id)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 경기 결과 입력 (대회 운영자)
export async function PATCH(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    const body = await request.json();
    if (body.action === 'schedule') return NextResponse.json({ ok: true, ...(await setMatchSchedule(params.id, body.matchId, body.scheduledAt)) });
    return NextResponse.json({ ok: true, ...(await reportMatch(body.matchId, body)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 🔄 대진 취소 (진행중 → 모집중, 대진만 삭제) — 대회 운영자
export async function DELETE(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    return NextResponse.json({ ok: true, ...(await cancelBracket(params.id)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
