import { NextResponse } from 'next/server';
import { generateBracket, reportMatch } from '../../../../../src/repo-tournament.js';
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
    return NextResponse.json({ ok: true, ...(await reportMatch(body.matchId, body)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
