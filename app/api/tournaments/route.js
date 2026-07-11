import { NextResponse } from 'next/server';
import { listTournaments, createTournament } from '../../../src/repo-tournament.js';
import { requireEditor, errStatus } from '../../../src/auth.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    return NextResponse.json({ ok: true, tournaments: await listTournaments(gid) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const body = await request.json();
    await requireEditor(request, body.gid);
    return NextResponse.json({ ok: true, tournament: await createTournament(body.gid, body) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
