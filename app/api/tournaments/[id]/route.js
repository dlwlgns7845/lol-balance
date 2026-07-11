import { NextResponse } from 'next/server';
import { getTournament } from '../../../../src/repo-tournament.js';

export async function GET(request, { params }) {
  try {
    const data = await getTournament(params.id);
    if (!data) return NextResponse.json({ ok: false, error: '대회를 찾을 수 없어요' }, { status: 404 });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
