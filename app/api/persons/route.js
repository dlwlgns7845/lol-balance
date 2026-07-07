import { NextResponse } from 'next/server';
import { listPersons, createPerson } from '../../../src/repo.js';
import { requireEditor, errStatus } from '../../../src/auth.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    return NextResponse.json({ ok: true, persons: await listPersons(gid) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    await requireEditor(request, body.group_id);
    return NextResponse.json({ ok: true, person: await createPerson(body.group_id, body) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
