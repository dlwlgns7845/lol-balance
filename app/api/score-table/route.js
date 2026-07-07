import { NextResponse } from 'next/server';
import { getScoreTable, setScoreTable } from '../../../src/repo.js';
import { requireEditor, errStatus } from '../../../src/auth.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    return NextResponse.json({ ok: true, table: await getScoreTable(gid) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST { group_id, table }  (table=null 이면 기본값으로 리셋)
export async function POST(request) {
  try {
    const { group_id, table } = await request.json();
    await requireEditor(request, group_id);
    await setScoreTable(group_id, table);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
