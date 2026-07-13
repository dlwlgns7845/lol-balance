import { NextResponse } from 'next/server';
import { addPoolPlayer, removePoolPlayer, sellPlayer, undoSale } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, errStatus } from '../../../../../src/auth.js';

// 선수 풀 등록 (공개 — 누구나 참가 신청)
export async function POST(request, { params }) {
  try {
    const body = await request.json();
    return NextResponse.json({ ok: true, player: await addPoolPlayer(params.id, body) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}

// 낙찰 / 낙찰취소 / 선수삭제 (대회 운영자)
export async function PATCH(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    const body = await request.json();
    if (body.action === 'sell') return NextResponse.json({ ok: true, ...(await sellPlayer(params.id, body)) });
    if (body.action === 'undo') return NextResponse.json({ ok: true, ...(await undoSale(params.id, body.poolId)) });
    if (body.action === 'remove') { await removePoolPlayer(body.poolId); return NextResponse.json({ ok: true }); }
    throw new Error('알 수 없는 동작');
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
