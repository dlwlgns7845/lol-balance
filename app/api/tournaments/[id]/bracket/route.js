import { NextResponse } from 'next/server';
import { generateBracket, reportMatch, getTournament } from '../../../../../src/repo-tournament.js';
import { requireEditor, errStatus } from '../../../../../src/auth.js';

// 대진 생성 (운영자)
export async function POST(request, { params }) {
  try {
    const t = await getTournament(params.id);
    if (!t) throw new Error('대회 없음');
    await requireEditor(request, t.tournament.group_id);
    return NextResponse.json({ ok: true, ...(await generateBracket(params.id)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}

// 경기 결과 입력 (운영자)
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const t = await getTournament(params.id);
    if (!t) throw new Error('대회 없음');
    await requireEditor(request, t.tournament.group_id);
    return NextResponse.json({ ok: true, ...(await reportMatch(body.matchId, body)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
