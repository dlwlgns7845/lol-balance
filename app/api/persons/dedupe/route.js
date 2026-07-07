import { NextResponse } from 'next/server';
import { dedupeByNick } from '../../../../src/repo.js';
import { requireEditor, errStatus } from '../../../../src/auth.js';

export async function POST(request) {
  try {
    const { group_id } = await request.json();
    await requireEditor(request, group_id);
    const r = await dedupeByNick(group_id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
