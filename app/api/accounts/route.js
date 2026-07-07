import { NextResponse } from 'next/server';
import { addAccount } from '../../../src/repo.js';
import { requireEditor, errStatus } from '../../../src/auth.js';

export async function POST(request) {
  try {
    const body = await request.json();
    await requireEditor(request, body.gid || body.group_id);
    return NextResponse.json({ ok: true, account: await addAccount(body) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
