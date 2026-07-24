import { NextResponse } from 'next/server';
import { listTournaments, createTournament } from '../../../src/repo-tournament.js';
import { getUser, isAdmin, errStatus } from '../../../src/auth.js';

export async function GET(request) {
  try {
    const u = await getUser(request);
    const admin = isAdmin(u);
    return NextResponse.json({ ok: true, isAdmin: admin, tournaments: await listTournaments({ all: admin, ownerId: u?.id }) });
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
