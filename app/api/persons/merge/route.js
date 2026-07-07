import { NextResponse } from 'next/server';
import { mergePersons } from '../../../../src/repo.js';
import { requireEditor, errStatus } from '../../../../src/auth.js';

// POST { gid, keepId, mergeId } → mergeId를 keepId로 흡수
export async function POST(request) {
  try {
    const { gid, keepId, mergeId } = await request.json();
    await requireEditor(request, gid);
    await mergePersons(keepId, mergeId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
