import { NextResponse } from 'next/server';
import { listTournaments, createTournament } from '../../../src/repo-tournament.js';
import { getUser, errStatus } from '../../../src/auth.js';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, tournaments: await listTournaments() });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const user = await getUser(request);
    if (!user) { const e = new Error('대회를 만들려면 로그인하세요'); e.status = 401; throw e; }
    const body = await request.json();
    return NextResponse.json({ ok: true, tournament: await createTournament(user.id, body) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
