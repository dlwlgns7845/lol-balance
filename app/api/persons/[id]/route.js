import { NextResponse } from 'next/server';
import { updatePerson, deletePerson } from '../../../../src/repo.js';
import { requireEditor, errStatus } from '../../../../src/auth.js';

export async function PATCH(request, { params }) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await requireEditor(request, gid);
    const body = await request.json();
    return NextResponse.json({ ok: true, person: await updatePerson(params.id, body) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

export async function DELETE(request, { params }) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await requireEditor(request, gid);
    await deletePerson(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
