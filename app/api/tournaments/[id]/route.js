import { NextResponse } from 'next/server';
import { getTournament, updateTournament } from '../../../../src/repo-tournament.js';
import { requireTournamentOwner, errStatus } from '../../../../src/auth.js';

export async function GET(request, { params }) {
  try {
    const data = await getTournament(params.id);
    if (!data) return NextResponse.json({ ok: false, error: '대회를 찾을 수 없어요' }, { status: 404 });
    return NextResponse.json({ ok: true, ...data });
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
