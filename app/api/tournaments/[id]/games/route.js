import { NextResponse } from 'next/server';
import { saveTournamentGame, deleteTournamentGame } from '../../../../../src/repo-tournament.js';
import { getUser, errStatus } from '../../../../../src/auth.js';

// 멸망전 경기 기록 저장 (로그인 필요 — 올린 사람 = 참가자)
export async function POST(request, { params }) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    const body = await request.json();
    return NextResponse.json({ ok: true, ...(await saveTournamentGame(params.id, { ...body, uploader_user_id: user.id })) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 경기 기록 삭제 (로그인 필요)
export async function DELETE(request, { params }) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    const body = await request.json();
    return NextResponse.json({ ok: true, ...(await deleteTournamentGame(params.id, body.gameId)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
